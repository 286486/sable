import { bounds, createNodes, newId } from "./document.ts";
import { lookup, transformNodes } from "./edit.ts";
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
  // Chosen before the file's Nodes join the parent and move its bounds.
  const artboard = artboardOf(doc, lookup(doc, opts.parentId, "parentId"));
  const [group] = createNodes(doc, [
    { type: "group", parentId: opts.parentId, name: file.name, children: [] },
  ]).nodes as [Node];
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
