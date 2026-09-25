import { generateKeyBetween } from "fractional-indexing";
import { assertParent, bounds, childrenOf, createNodes, newId } from "./document.ts";
import { transformNodes } from "./edit.ts";
import type { Artboard, Document, Node, Rect } from "./schema.ts";

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The Artboard the Node's bounds overlap most, else the first one (ADR-0017). */
function artboardOf(doc: Document, node: Node): Artboard | undefined {
  const b = bounds(doc, node);
  let best = doc.artboards[0];
  let most = 0;
  for (const a of doc.artboards) {
    const area = b ? overlap(a.frame, b) : 0;
    if (area > most) [best, most] = [a, area];
  }
  return best;
}

/**
 * Place (ADR-0017): a file's Nodes as one new Group above `parentId`'s children. Layers become
 * Groups, every id is new, and the Group is centred on `position`, by default the parent's
 * Artboard, after `fit` scales it to that Artboard. Returns the new Nodes, the Group first.
 */
export function placeNodes(
  doc: Document,
  file: { name: string; nodes: Node[] },
  opts: { parentId: string; position?: { x: number; y: number }; fit?: boolean },
): { groupId: string; created: Node[] } {
  const [group] = createNodes(doc, [
    { type: "group", parentId: opts.parentId, name: file.name, children: [] },
  ]).nodes as [Node];
  // Chosen while the Group is empty, before the file's Nodes move the parent's bounds.
  const artboard = artboardOf(doc, doc.nodes.get(opts.parentId) as Node);
  const ids = new Map(file.nodes.map((n) => [n.id, newId()]));
  for (const n of file.nodes) {
    const id = ids.get(n.id) as string;
    const parentId = n.parentId === null ? group.id : (ids.get(n.parentId) as string);
    doc.nodes.set(id, { ...n, id, parentId, ...(n.type === "layer" && { type: "group" }) });
  }

  const b = bounds(doc, group);
  const target = opts.position ??
    (artboard && {
      x: artboard.frame.x + artboard.frame.width / 2,
      y: artboard.frame.y + artboard.frame.height / 2,
    }) ?? { x: 0, y: 0 };
  if (b) {
    const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    // A file flat in one direction fits by the other; a single point keeps its size.
    const ratios = artboard
      ? [
          b.width > 0 ? artboard.frame.width / b.width : Infinity,
          b.height > 0 ? artboard.frame.height / b.height : Infinity,
        ]
      : [];
    const s = Math.min(...ratios);
    transformNodes(doc, {
      nodeIds: [group.id],
      pivot: centre,
      ...(opts.fit && Number.isFinite(s) && { scale: s }),
      translate: { x: target.x - centre.x, y: target.y - centre.y },
    });
  }
  return {
    groupId: group.id,
    created: [group.id, ...ids.values()].map((id) => doc.nodes.get(id) as Node),
  };
}

/**
 * Place for a bitmap (ADR-0027): an Image of the stored file `src` in `parentId`, framed by `frame`
 * (size default the file's pixels), else its pixel size centred on the parent's Artboard. With
 * `asTemplate`, on a new locked Template Layer beneath the parent's Layer, at 50% opacity. Returns
 * the new Nodes, the Layer first.
 */
export function placeImage(
  doc: Document,
  file: { src: string; name: string },
  opts: {
    parentId: string;
    frame?: { x: number; y: number; width?: number; height?: number };
    asTemplate?: boolean;
  },
): { created: Node[] } {
  assertParent(doc, { type: "image" }, opts.parentId, "parentId");
  const parent = doc.nodes.get(opts.parentId) as Node;
  const info = doc.images.get(file.src);
  const width = opts.frame?.width ?? info?.width ?? 0;
  const height = opts.frame?.height ?? info?.height ?? 0;
  const frame = artboardOf(doc, parent)?.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const { x, y } = opts.frame ?? {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
  };

  const created: Node[] = [];
  let parentId = opts.parentId;
  if (opts.asTemplate) {
    let holder = parent;
    while (holder.type !== "layer") holder = doc.nodes.get(holder.parentId as string) as Node;
    const [made] = createNodes(doc, [
      { type: "layer", parentId: holder.parentId, name: `Template ${file.name}` },
    ]).nodes as [Node];
    const siblings = childrenOf(doc, holder.parentId);
    const below = siblings[siblings.findIndex((n) => n.id === holder.id) - 1];
    const layer = {
      ...made,
      locked: true,
      index: generateKeyBetween(below?.index ?? null, holder.index),
    };
    doc.nodes.set(layer.id, layer);
    created.push(layer);
    parentId = layer.id;
  }
  const [made] = createNodes(doc, [{ type: "image", parentId, src: file.src, x, y, width, height }])
    .nodes as [Node];
  const image = opts.asTemplate ? { ...made, opacity: 0.5 } : made;
  doc.nodes.set(image.id, image);
  created.push(image);
  return { created };
}
