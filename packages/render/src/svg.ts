import {
  childrenOf,
  type Document,
  formatNumber,
  formatPath,
  IDENTITY,
  type Node,
  type Rect,
  shapeSegments,
  union,
} from "@zibel/core";

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
