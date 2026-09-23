import { generateKeyBetween } from "fractional-indexing";
import { ulid } from "ulid";
import { parseColor } from "./color.ts";
import { ZibelError } from "./errors.ts";
import {
  type Appearance,
  AppearanceInput,
  type Artboard,
  type ArtboardInput,
  type Document,
  type LayerNode,
  type Matrix,
  type Node,
  NodeInput,
  type Rect,
} from "./schema.ts";

/** Server-generated ULID for Documents, Nodes, Artboards and Transactions. */
export const newId = () => ulid();

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const ARTBOARD_GAP = 20;

const base = (parentId: string | null, index: string) => ({
  id: newId(),
  parentId,
  index,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  transform: [...IDENTITY] as Matrix,
  tags: [],
  meta: {},
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

/**
 * Validates every input first, then adds all Nodes, so a bad item leaves the Document unchanged.
 * Returns the new Nodes in input order.
 */
export function createNodes(doc: Document, inputs: NodeInput[]): Node[] {
  const lastIndex = new Map<string, string | null>();
  const created = inputs.map((raw, i): Node => {
    const input = NodeInput.parse(raw);
    const path = `nodes[${i}].parentId`;
    const parent = doc.nodes.get(input.parentId);
    if (!parent) {
      const isArtboard = doc.artboards.some((a) => a.id === input.parentId);
      throw new ZibelError(
        isArtboard
          ? {
              code: "INVALID_PARENT",
              message: "An Artboard is not a Node and cannot be a parent.",
              hint: "Use a Layer id as parentId; position the Node inside the Artboard's frame instead.",
              path,
            }
          : {
              code: "NODE_NOT_FOUND",
              message: `No Node with id ${input.parentId}.`,
              hint: "Use doc_outline to list Layer ids; doc_create returns the default Layer id.",
              path,
            },
      );
    }
    if (parent.type !== "layer") {
      throw new ZibelError({
        code: "INVALID_PARENT",
        message: `A ${parent.type} cannot contain other Nodes.`,
        hint: "parentId must be a Layer or Group.",
        path,
      });
    }
    const prev = lastIndex.has(parent.id)
      ? (lastIndex.get(parent.id) ?? null)
      : (childrenOf(doc, parent.id).at(-1)?.index ?? null);
    const index = generateKeyBetween(prev, null);
    lastIndex.set(parent.id, index);
    const { parentId: _, clientKey: __, name, appearance, ...shape } = input;
    return {
      ...base(parent.id, index),
      ...shape,
      name: name ?? "",
      appearance: paint(appearance ?? DEFAULT_APPEARANCE, `nodes[${i}].appearance`),
    };
  });
  for (const node of created) doc.nodes.set(node.id, node);
  return created;
}

/** Illustrator's basic appearance for a new shape. */
const DEFAULT_APPEARANCE = AppearanceInput.parse({
  fills: [{ color: "#FFFFFF" }],
  strokes: [{ color: "#000000" }],
});

function paint(a: AppearanceInput, path: string): Appearance {
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
  // ponytail: ignores `transform`, which stays identity until node_transform (#5) can set it.
  if (node.type === "rect") return { x: node.x, y: node.y, width: node.width, height: node.height };
  return union(childrenOf(doc, node.id).map((c) => bounds(doc, c)));
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
