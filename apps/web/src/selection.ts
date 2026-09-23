import {
  bounds,
  childrenOf,
  type Document,
  formatPath,
  type Node,
  type Rect,
  type ShapeNode,
  scaleOf,
  shapeSegments,
  transformSegments,
  worldTransform,
} from "@zibel/core";

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

/** Every selectable object (visible and unlocked, as is everything above it), in draw order. */
export function objects(doc: Document): Node[] {
  const walk = (parentId: string | null): Node[] =>
    childrenOf(doc, parentId).flatMap((n) => {
      if (!n.visible || n.locked) return [];
      return n.type === "layer" ? walk(n.id) : [n];
    });
  return walk(null);
}

/**
 * The object whose topmost selectable leaf is painted at (x, y) in document coordinates, within
 * `tolerance` pt of its outline, or null. Hidden and locked Nodes let the click through.
 */
export function hitTest(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  x: number,
  y: number,
  tolerance: number,
): string | null {
  let hit: Node | null = null;
  const walk = (parentId: string | null) => {
    for (const n of childrenOf(doc, parentId)) {
      if (!n.visible || n.locked) continue;
      if (n.type === "layer" || n.type === "group") walk(n.id);
      else if (paintedAt(ctx, doc, n, x, y, tolerance)) hit = n;
    }
  };
  ctx.save();
  // The path and the point are both in document coordinates.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  walk(null);
  ctx.restore();
  return hit && (objectOf(doc, hit)?.id ?? null);
}

/** Inside a Fill, or on the outline (painted or not, as Illustrator hits an unpainted Path). */
function paintedAt(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  n: ShapeNode,
  x: number,
  y: number,
  tolerance: number,
): boolean {
  const m = worldTransform(doc, n);
  const path = new Path2D(formatPath(transformSegments(shapeSegments(n), m)));
  if (n.appearance.fills.length > 0 && ctx.isPointInPath(path, x, y)) return true;
  const widest = Math.max(0, ...n.appearance.strokes.map((s) => s.width)) * scaleOf(m);
  ctx.lineWidth = Math.max(widest, tolerance);
  return ctx.isPointInStroke(path, x, y);
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
