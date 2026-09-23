import {
  childrenOf,
  type Document,
  formatPath,
  type Node,
  type Rect,
  shapeSegments,
  union,
} from "@zibel/core";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const attrs = (a: Record<string, string | number | undefined>) =>
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
  const opacity = n.opacity === 1 ? undefined : n.opacity;
  if (n.type === "layer" || n.type === "group") {
    const kids = childrenOf(doc, n.id)
      .map((c) => node(doc, c))
      .join("");
    return `<g${attrs({ opacity })}>${kids}</g>`;
  }
  // Every leaf is a <path> of the same outline node_get reports as d, painted once per Fill, then
  // once per Stroke: Illustrator's default stacking, Fills below Strokes.
  const d = formatPath(shapeSegments(n));
  const paints = [
    ...n.appearance.fills.map((f) => `<path${attrs({ d, fill: f.color })}/>`),
    ...n.appearance.strokes.map(
      (s) =>
        `<path${attrs({
          d,
          fill: "none",
          stroke: s.color,
          "stroke-width": s.width,
          "stroke-linecap": s.cap === "butt" ? undefined : s.cap,
          "stroke-linejoin": s.join === "miter" ? undefined : s.join,
          // SVG's default miter limit is 4, Illustrator's is 10: always write it for miter joins.
          "stroke-miterlimit": s.join === "miter" ? s.miterLimit : undefined,
          "stroke-dasharray": s.dash.length > 0 ? s.dash.join(" ") : undefined,
        })}/>`,
    ),
  ].join("");
  return opacity === undefined || !paints ? paints : `<g${attrs({ opacity })}>${paints}</g>`;
}
