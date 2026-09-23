import { bounds, childrenOf, type Document, type Node, type Rect } from "@zibel/core";

/**
 * What Illustrator's Selection tool picks for `node`: its outermost ancestor below a Layer, so a
 * click inside a Group selects the Group. Null for a Layer.
 */
export function objectOf(doc: Document, node: Node): Node | null {
  if (node.type === "layer") return null;
  let object = node;
  for (let p = doc.nodes.get(node.parentId ?? ""); p && p.type !== "layer"; ) {
    object = p;
    p = doc.nodes.get(p.parentId ?? "");
  }
  return object;
}

/** Visible and unlocked, and so is everything above it. */
export function selectable(doc: Document, node: Node): boolean {
  for (let n: Node | undefined = node; n; n = doc.nodes.get(n.parentId ?? "")) {
    if (!n.visible || n.locked) return false;
  }
  return true;
}

/** Every selectable object, in draw order: Select All. */
export function objects(doc: Document): Node[] {
  const walk = (parentId: string | null): Node[] =>
    childrenOf(doc, parentId).flatMap((n) => {
      if (!n.visible || n.locked) return [];
      return n.type === "layer" ? walk(n.id) : [n];
    });
  return walk(null);
}

/** A click or marquee's `ids` applied to the Selection: replace; Shift toggles; Alt+Shift removes. */
export function combine(
  selection: string[],
  ids: string[],
  { shift, alt }: { shift: boolean; alt: boolean },
): string[] {
  if (!shift) return ids;
  const out = selection.filter((id) => !ids.includes(id));
  return alt ? out : [...out, ...ids.filter((id) => !selection.includes(id))];
}

/** The selectable objects whose bounds touch `rect`. */
export function marquee(doc: Document, rect: Rect): string[] {
  const touches = (b: Rect | null) =>
    !!b &&
    b.x <= rect.x + rect.width &&
    rect.x <= b.x + b.width &&
    b.y <= rect.y + rect.height &&
    rect.y <= b.y + b.height;
  return objects(doc)
    .filter((n) => touches(bounds(doc, n)))
    .map((n) => n.id);
}

export const inverse = (doc: Document, selection: string[]) =>
  objects(doc)
    .map((n) => n.id)
    .filter((id) => !selection.includes(id));
