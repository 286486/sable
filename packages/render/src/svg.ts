import { childrenOf, type Document, type Node } from "@zibel/core";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");

/** SVG for one Artboard: its frame is the viewBox, Layers become `<g>` in stacking order. */
export function toSvg(doc: Document, artboardIndex = 0): string {
  const artboard = doc.artboards[artboardIndex];
  if (!artboard) throw new RangeError(`No Artboard at index ${artboardIndex}`);
  const { x, y, width, height } = artboard.frame;
  const background = artboard.background
    ? `<rect${attrs({ x, y, width, height, fill: artboard.background })}/>`
    : "";
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
