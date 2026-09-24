import {
  bounds,
  childrenOf,
  type Document,
  formatPath,
  type LeafNode,
  type Node,
  type Rect,
  scaleOf,
  shapeSegments,
  touches,
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

/**
 * Where Place puts pasted or dropped art (ADR-0017): the nearest Layer holding the first selected
 * Node, else the top Layer.
 */
export function placeParent(doc: Document, selection: string[]): string | undefined {
  for (let n = doc.nodes.get(selection[0] ?? ""); n; n = doc.nodes.get(n.parentId ?? "")) {
    if (n.type === "layer") return n.id;
  }
  return childrenOf(doc, null).at(-1)?.id;
}

/**
 * Every selectable object (visible and unlocked, as is everything above it) in the Document, or in
 * the Layer `layerId`, in draw order.
 */
export function objects(doc: Document, layerId: string | null = null): Node[] {
  const walk = (parentId: string | null): Node[] =>
    childrenOf(doc, parentId).flatMap((n) => {
      if (!n.visible || n.locked) return [];
      return n.type === "layer" ? walk(n.id) : [n];
    });
  return walk(layerId);
}

/**
 * Visible and unlocked, itself and every ancestor: what a canvas gesture may move or delete. A Layers
 * panel row can select a Node that is not (ADR-0012).
 */
export function editable(doc: Document, node: Node | undefined): boolean {
  if (!node) return false;
  for (let n: Node | undefined = node; n; n = doc.nodes.get(n.parentId ?? "")) {
    if (!n.visible || n.locked) return false;
  }
  return true;
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

/**
 * Inside a Fill, or on the outline (painted or not, as Illustrator hits an unpainted Path); a
 * text anywhere inside its bounds.
 */
function paintedAt(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  n: LeafNode,
  x: number,
  y: number,
  tolerance: number,
): boolean {
  if (n.type === "text") {
    const b = bounds(doc, n);
    return !!b && b.x <= x && x <= b.x + b.width && b.y <= y && y <= b.y + b.height;
  }
  const m = worldTransform(doc, n);
  const path = new Path2D(formatPath(transformSegments(shapeSegments(n), m)));
  const rule = n.type === "path" && n.fillRule === "evenodd" ? "evenodd" : "nonzero";
  if (n.appearance.fills.length > 0 && ctx.isPointInPath(path, x, y, rule)) return true;
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
  return objects(doc)
    .filter((n) => {
      const b = bounds(doc, n);
      return !!b && touches(b, rect);
    })
    .map((n) => n.id);
}

export const inverse = (doc: Document, selection: string[]) =>
  objects(doc)
    .map((n) => n.id)
    .filter((id) => !selection.includes(id));
