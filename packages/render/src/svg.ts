import { childrenOf, type Document, type Node, type Rect, union } from "@zibel/core";

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
  if (n.type === "layer") {
    const kids = childrenOf(doc, n.id)
      .map((c) => node(doc, c))
      .join("");
    return `<g${attrs({ opacity })}>${kids}</g>`;
  }
  // ponytail: paints the top Fill and Stroke only; stacked Appearance needs one element per layer.
  const fill = n.appearance.fills.at(-1);
  const stroke = n.appearance.strokes.at(-1);
  return `<rect${attrs({
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    fill: fill?.color ?? "none",
    stroke: stroke?.color,
    "stroke-width": stroke?.width,
    opacity,
  })}/>`;
}
