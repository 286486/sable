import { generateKeyBetween } from "fractional-indexing";
import { ulid } from "ulid";
import type { z } from "zod";
import { parseColor } from "./color.ts";
import { collect, type Failed, ZibelError } from "./errors.ts";
import { IDENTITY, multiply, scaleOf, transformSegments } from "./matrix.ts";
import { formatPath, parsePath, pathBounds, shapeSegments } from "./path.ts";
import {
  type Appearance,
  AppearanceInput,
  type Artboard,
  type ArtboardInput,
  type ChildInput,
  type Document,
  type LayerNode,
  type Matrix,
  type Node,
  NodeInput,
  type Rect,
  Shape,
  type ShapeNode,
} from "./schema.ts";

/** Server-generated ULID for Documents, Nodes, Artboards and Transactions. */
export const newId = () => ulid();

const ARTBOARD_GAP = 20;

const base = (parentId: string | null, index: string) => ({
  id: newId(),
  parentId,
  index,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal" as const,
  transform: [...IDENTITY] as Matrix,
  tags: [] as string[],
  meta: {} as Record<string, unknown>,
});

/** A new Document with its Artboards and one default Layer to draw into. */
export function createDocument(input: { id: string; name: string; artboards: ArtboardInput[] }): {
  doc: Document;
  defaultLayerId: string;
} {
  let nextX = 0;
  const artboards = input.artboards.map((a, i): Artboard => {
    const x = a.x ?? nextX;
    nextX = x + a.width + ARTBOARD_GAP;
    return {
      id: newId(),
      name: a.name ?? `Artboard ${i + 1}`,
      frame: { x, y: a.y ?? 0, width: a.width, height: a.height },
      ...(a.background !== undefined && {
        background: parseColor(a.background, `artboards[${i}].background`),
      }),
    };
  });
  const layer: LayerNode = {
    ...base(null, generateKeyBetween(null, null)),
    type: "layer",
    name: "Layer 1",
  };
  const doc: Document = {
    id: input.id,
    name: input.name,
    version: 1,
    rev: 0,
    artboards,
    nodes: new Map([[layer.id, layer]]),
  };
  return { doc, defaultLayerId: layer.id };
}

/** Most Nodes one `node_create` may add, counting inline Group children (REQUIREMENTS §6.5). */
export const MAX_NODES_PER_CREATE = 2000;

const countNodes = (items: { children?: unknown[] }[]): number =>
  items.reduce(
    (n, item) => n + 1 + countNodes((item.children ?? []) as { children?: unknown[] }[]),
    0,
  );

/**
 * Validates every input first, then adds all Nodes, so a bad item leaves the Document unchanged.
 * Returns the new Nodes depth first in input order (a Group before its inline children), and the
 * `clientKey` → id map for the WriteReceipt.
 */
export function createNodes(
  doc: Document,
  inputs: NodeInput[],
  { partial = false } = {},
): { nodes: Node[]; keyMap: Record<string, string>; failed: Failed[] } {
  const lastIndex = new Map<string | null, string | null>();
  const nextIndex = (parentId: string | null) => {
    const prev = lastIndex.has(parentId)
      ? (lastIndex.get(parentId) ?? null)
      : (childrenOf(doc, parentId).at(-1)?.index ?? null);
    const index = generateKeyBetween(prev, null);
    lastIndex.set(parentId, index);
    return index;
  };
  const add = (
    input: z.output<typeof NodeInput> | ChildInput,
    parentId: string | null,
    path: string,
    out: { nodes: Node[]; keyMap: Record<string, string> },
  ) => {
    const at = {
      ...base(parentId, nextIndex(parentId)),
      ...(input.tags && { tags: input.tags }),
      ...(input.meta && { meta: input.meta }),
    };
    const name = input.name ?? "";
    let node: Node;
    if (input.type === "layer" || input.type === "group") {
      node = { ...at, type: input.type, name };
    } else {
      // Parsing with the Shape schema keeps the parameters and drops clientKey, name and the rest.
      const shape = Shape.parse(input);
      if (shape.type === "path") shape.d = formatPath(parsePath(shape.d, `${path}.d`));
      const appearance = paint(input.appearance ?? defaultAppearance(), `${path}.appearance`);
      node = { ...at, ...shape, name, appearance };
    }
    out.nodes.push(node);
    if (input.clientKey !== undefined) out.keyMap[input.clientKey] = node.id;
    if (input.type === "group") {
      input.children.forEach((child, k) => {
        if (child.type === "layer") {
          throw new ZibelError({
            code: "INVALID_PARENT",
            message: "A Group never contains a Layer.",
            hint: "Create the Layer on its own with a Layer id as parentId (or none for the root), then put Groups in it.",
            path: `${path}.children[${k}].type`,
          });
        }
        add(child, node.id, `${path}.children[${k}]`, out);
      });
    }
  };
  const count = countNodes(inputs as { children?: unknown[] }[]);
  if (count > MAX_NODES_PER_CREATE) {
    throw new ZibelError({
      code: "LIMIT_EXCEEDED",
      message: `${count} Nodes counting inline children; one node_create adds at most ${MAX_NODES_PER_CREATE}.`,
      hint: `Split into several node_create calls of at most ${MAX_NODES_PER_CREATE} Nodes each, e.g. one per Layer or Group: create the Group first, then its children with its id as parentId.`,
      path: "nodes",
    });
  }
  const { ok, failed } = collect(inputs, partial, (raw, i) => {
    // Each item collects into its own lists, so a failure halfway through a Group leaves no trace.
    const out = { nodes: [] as Node[], keyMap: {} as Record<string, string> };
    const input = NodeInput.parse(raw);
    assertParent(doc, input, input.parentId, `nodes[${i}].parentId`);
    add(input, input.parentId, `nodes[${i}]`, out);
    return out;
  });
  for (const item of ok) for (const node of item.nodes) doc.nodes.set(node.id, node);
  return {
    nodes: ok.flatMap((item) => item.nodes),
    keyMap: Object.assign({}, ...ok.map((item) => item.keyMap)),
    failed,
  };
}

/**
 * The tree rules (ADR-0005): a Layer's parent is the root or a Layer; every other Node's parent is a
 * Layer or Group; an Artboard is never a parent; no Node is its own ancestor.
 */
export function assertParent(
  doc: Document,
  child: { type: Node["type"]; id?: string },
  parentId: string | null,
  path: string,
): void {
  const invalid = (message: string, hint: string) =>
    new ZibelError({ code: "INVALID_PARENT", message, hint, path });
  if (parentId === null) {
    if (child.type === "layer") return;
    throw invalid(
      `A ${child.type} cannot sit at the Document root; only a Layer can.`,
      "Use a Layer id as parentId; doc_create returns the default Layer id.",
    );
  }
  const parent = doc.nodes.get(parentId);
  if (!parent) {
    if (doc.artboards.some((a) => a.id === parentId)) {
      throw invalid(
        "An Artboard is not a Node and cannot be a parent.",
        "Use a Layer id as parentId; position the Node inside the Artboard's frame instead.",
      );
    }
    throw new ZibelError({
      code: "NODE_NOT_FOUND",
      message: `No Node with id ${parentId}.`,
      hint: "Use doc_outline to list Layer ids; doc_create returns the default Layer id.",
      path,
    });
  }
  if (child.type === "layer" && parent.type !== "layer") {
    throw invalid(
      `A Layer's parent is the Document root or another Layer, never a ${parent.type}.`,
      "Omit parentId for a top-level Layer, or use a Layer id.",
    );
  }
  if (parent.type !== "layer" && parent.type !== "group") {
    throw invalid(
      `A ${parent.type} cannot contain other Nodes.`,
      "parentId must be a Layer or Group.",
    );
  }
  for (
    let p: Node | undefined = parent;
    p;
    p = p.parentId ? doc.nodes.get(p.parentId) : undefined
  ) {
    if (p.id === child.id) {
      throw invalid(
        "The parent is the Node itself or one of its descendants, which would make a cycle.",
        "Choose a parent outside this Node's subtree.",
      );
    }
  }
}

/** Illustrator's basic appearance for a new shape, fresh per Node so no two share arrays. */
const defaultAppearance = () =>
  AppearanceInput.parse({ fills: [{ color: "#FFFFFF" }], strokes: [{ color: "#000000" }] });

export function paint(a: AppearanceInput, path: string): Appearance {
  return {
    fills: a.fills.map((f, i) => ({
      ...f,
      color: parseColor(f.color, `${path}.fills[${i}].color`),
    })),
    strokes: a.strokes.map((s, i) => ({
      ...s,
      color: parseColor(s.color, `${path}.strokes[${i}].color`),
    })),
  };
}

// ponytail: scans every Node per lookup; keep a parent index beside the map when Documents grow.
export function childrenOf(doc: Document, parentId: string | null): Node[] {
  return [...doc.nodes.values()]
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
}

/** Geometric bounds in document coordinates (no stroke), or null for an empty container. */
export function bounds(doc: Document, node: Node): Rect | null {
  if (node.type === "layer" || node.type === "group") {
    return union(childrenOf(doc, node.id).map((c) => bounds(doc, c)));
  }
  return pathBounds(transformSegments(shapeSegments(node), worldTransform(doc, node)));
}

/** Geometric bounds grown by half the widest Stroke, for a leaf; the union of its children's, for a container. */
export function visibleBounds(doc: Document, node: Node): Rect | null {
  if (node.type === "layer" || node.type === "group") {
    return union(childrenOf(doc, node.id).map((c) => visibleBounds(doc, c)));
  }
  const b = bounds(doc, node);
  // ponytail: half the Stroke width on every side, scaled by sqrt|det|; miter spikes, square caps
  // and non-uniform scale can reach further.
  const grow =
    (Math.max(0, ...node.appearance.strokes.map((s) => s.width)) / 2) *
    scaleOf(worldTransform(doc, node));
  return (
    b && { x: b.x - grow, y: b.y - grow, width: b.width + 2 * grow, height: b.height + 2 * grow }
  );
}

/**
 * The Node's transform composed with every ancestor's, mapping its coordinates to the Document's.
 * Containers stay identity (ADR-0007), so this equals a leaf's own transform; composing keeps it
 * correct should a container ever carry one.
 */
export function worldTransform(doc: Document, node: Node): Matrix {
  const parent = node.parentId ? doc.nodes.get(node.parentId) : undefined;
  return parent ? multiply(worldTransform(doc, parent), node.transform) : node.transform;
}

function outlineOf(node: ShapeNode): { d: string; closed: boolean } {
  const segments = shapeSegments(node);
  return { d: formatPath(segments), closed: segments.at(-1)?.cmd === "Z" };
}

export interface ConciseView {
  id: string;
  type: Node["type"];
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  childCount: number;
  geometricBounds: Rect | null;
}

/** Every stored property, the derived `d` of a Live Shape or Path, and the derived bounds (F-DOC-03a). */
export type FullView = Node &
  ConciseView & {
    d?: string;
    closed?: boolean;
    visibleBounds: Rect | null;
    worldTransform: Matrix;
  };

/** A Node as `node_get` returns it. */
export function nodeView(doc: Document, node: Node, detail: "concise"): ConciseView;
export function nodeView(doc: Document, node: Node, detail: "full"): FullView;
export function nodeView(
  doc: Document,
  node: Node,
  detail: "concise" | "full",
): ConciseView | FullView;
export function nodeView(doc: Document, node: Node, detail: "concise" | "full") {
  const { id, type, name, parentId, visible, locked } = node;
  const concise: ConciseView = {
    id,
    type,
    name,
    parentId,
    visible,
    locked,
    childCount: childrenOf(doc, id).length,
    geometricBounds: bounds(doc, node),
  };
  if (detail === "concise") return concise;
  return {
    ...node,
    ...concise,
    ...(node.type !== "layer" && node.type !== "group" && outlineOf(node)),
    visibleBounds: visibleBounds(doc, node),
    worldTransform: worldTransform(doc, node),
  };
}

export interface OutlineNode {
  id: string;
  type: Node["type"];
  name: string;
  bounds: Rect | null;
  childCount: number;
  visible: boolean;
  locked: boolean;
  children?: OutlineNode[];
}

/** Sparse tree whose top level is always the Layer list. */
export function outline(doc: Document, depth = 2): OutlineNode[] {
  const walk = (parentId: string | null, level: number): OutlineNode[] =>
    childrenOf(doc, parentId).map((n) => {
      const kids = childrenOf(doc, n.id);
      return {
        id: n.id,
        type: n.type,
        name: n.name,
        bounds: bounds(doc, n),
        childCount: kids.length,
        visible: n.visible,
        locked: n.locked,
        ...(kids.length > 0 && level < depth && { children: walk(n.id, level + 1) }),
      };
    });
  return walk(null, 1);
}

export function union(rects: (Rect | null)[]): Rect | null {
  const rs = rects.filter((r): r is Rect => r !== null);
  if (rs.length === 0) return null;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const right = Math.max(...rs.map((r) => r.x + r.width));
  const bottom = Math.max(...rs.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}
