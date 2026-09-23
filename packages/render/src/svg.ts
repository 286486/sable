import {
  childrenOf,
  type Document,
  formatNumber,
  formatPath,
  IDENTITY,
  lookup,
  type Node,
  type Rect,
  type RenderScope,
  shapeSegments,
  union,
  visibleBounds,
  ZibelError,
} from "@zibel/core";

/** The longest side `render` and `export` rasterise (REQUIREMENTS §7). */
export const MAX_RENDER_SIDE = 4096;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

type Attrs = Record<string, string | number | undefined>;

const attrs = (a: Attrs) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");

/** The area a doc-scope render covers: every Artboard. */
export function docRect(doc: Document): Rect {
  return union(doc.artboards.map((a) => a.frame)) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The rect a Render Scope covers, in document coordinates (ADR-0014). */
export function scopeRect(doc: Document, scope?: RenderScope): Rect {
  if (!scope) return docRect(doc);
  if ("rect" in scope) return scope.rect;
  if ("artboardId" in scope) {
    const artboard = doc.artboards.find((a) => a.id === scope.artboardId);
    if (artboard) return artboard.frame;
    throw new ZibelError({
      code: "ARTBOARD_NOT_FOUND",
      message: `No Artboard with id ${scope.artboardId}.`,
      hint: "zibel_doc_get_info lists the Artboards with their ids.",
      path: "scope.artboardId",
    });
  }
  const rect = union(
    scope.nodeIds.map((id, i) => visibleBounds(doc, lookup(doc, id, `scope.nodeIds[${i}]`))),
  );
  if (rect) return rect;
  throw new ZibelError({
    code: "NOTHING_TO_RENDER",
    message: "The listed Nodes are empty Layers or Groups: there is nothing to draw.",
    hint: "List Nodes that contain artwork, or pass scope {rect} instead.",
    path: "scope.nodeIds",
  });
}

/**
 * The scale, pixel size and rect of an image of `rect` at `scale`, lowered to fit `maxSize`.
 * resvg rounds the pixel size and stretches the drawing to it, so the rect widens to whole pixels
 * (by less than one) to keep `scale` the exact zoom drawn.
 */
export function fit(rect: Rect, scale: number, maxSize?: number) {
  const long = Math.max(rect.width, rect.height);
  const used = maxSize !== undefined && long * scale > maxSize ? maxSize / long : scale;
  // The epsilon keeps float noise such as 2000 × 0.8 = 1600.0000000000002 from adding a pixel.
  const px = (side: number) => Math.max(1, Math.ceil(side * used - 1e-6));
  if (px(long) > MAX_RENDER_SIDE) {
    const fits = Math.floor((MAX_RENDER_SIDE / long) * 100) / 100;
    const viaMaxSize = maxSize !== undefined && maxSize > MAX_RENDER_SIDE;
    throw new ZibelError({
      code: "LIMIT_EXCEEDED",
      message: `The image would be ${px(long)} px on its longest side; the limit is ${MAX_RENDER_SIDE}.`,
      hint: viaMaxSize
        ? `Use maxSize <= ${MAX_RENDER_SIDE} (default 1600), or scale <= ${fits}.`
        : `Use scale <= ${fits}, or a smaller scope.`,
      path: viaMaxSize ? "maxSize" : "scale",
    });
  }
  const pixelSize = { width: px(rect.width), height: px(rect.height) };
  const widen = (side: number, pixels: number) =>
    Math.abs(pixels / used - side) < 1e-9 ? side : pixels / used;
  return {
    rect: {
      ...rect,
      width: widen(rect.width, pixelSize.width),
      height: widen(rect.height, pixelSize.height),
    },
    scale: used,
    pixelSize,
  };
}

/** SVG of `rect` in document coordinates (default: every Artboard). Layers become `<g>` in stacking order. */
export function toSvg(doc: Document, rect: Rect = docRect(doc)): string {
  const { x, y, width, height } = rect;
  const background = doc.artboards
    .filter((a) => a.background)
    .map((a) => `<rect${attrs({ ...a.frame, fill: a.background })}/>`)
    .join("");
  const body = childrenOf(doc, null)
    .map((n) => node(doc, n))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ width, height, viewBox: `${x} ${y} ${width} ${height}` })}>${background}${body}</svg>`;
}

function node(doc: Document, n: Node): string {
  if (!n.visible) return "";
  const group = {
    opacity: n.opacity === 1 ? undefined : n.opacity,
    transform: n.transform.every((v, i) => v === IDENTITY[i])
      ? undefined
      : `matrix(${n.transform.map(formatNumber).join(" ")})`,
  };
  if (n.type === "layer" || n.type === "group") {
    const kids = childrenOf(doc, n.id)
      .map((c) => node(doc, c))
      .join("");
    return `<g${attrs(group)}>${kids}</g>`;
  }
  // A leaf is painted once per Fill, then once per Stroke: Illustrator's default stacking, Fills
  // below Strokes. A Live Shape or Path is a <path> of the same outline node_get reports as d.
  const paint =
    n.type === "text"
      ? (a: Attrs) =>
          `<text${attrs({
            x: n.x,
            y: n.y,
            "font-family": n.fontFamily,
            "font-size": n.fontSize,
            // resvg honours font-kerning only as a style; unkerned, the drawn width is the
            // advance sum the bounds report (ADR-0013).
            style: "font-kerning:none",
            "xml:space": "preserve",
            ...a,
          })}>${esc(n.content)}</text>`
      : (a: Attrs) => `<path${attrs({ d: formatPath(shapeSegments(n)), ...a })}/>`;
  const paints = [
    ...n.appearance.fills.map((f) => paint({ fill: f.color })),
    ...n.appearance.strokes.map((s) =>
      paint({
        fill: "none",
        stroke: s.color,
        "stroke-width": s.width,
        "stroke-linecap": s.cap === "butt" ? undefined : s.cap,
        "stroke-linejoin": s.join === "miter" ? undefined : s.join,
        // SVG's default miter limit is 4, Illustrator's is 10: always write it for miter joins.
        "stroke-miterlimit": s.join === "miter" ? s.miterLimit : undefined,
        "stroke-dasharray": s.dash.length > 0 ? s.dash.join(" ") : undefined,
      }),
    ),
  ].join("");
  const wrap = attrs(group);
  return wrap && paints ? `<g${wrap}>${paints}</g>` : paints;
}
