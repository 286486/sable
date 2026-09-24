import {
  bounds,
  childrenOf,
  type Document,
  formatNumber,
  formatPath,
  IDENTITY,
  lookup,
  type Node,
  type Rect,
  type RenderOverlay,
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

/**
 * The rect an SVG `export` of `scope` covers: the scope's, but at doc scope the first Artboard.
 * Inkscape binds the page at (0,0) to the viewBox and resizes it on save, so the viewBox is the
 * file's first page and the other Artboards are pages outside it (ADR-0017).
 */
export function svgRect(doc: Document, scope?: RenderScope): Rect {
  return scope ? scopeRect(doc, scope) : (doc.artboards[0]?.frame ?? docRect(doc));
}

export interface SvgOptions {
  /** The Render Scope drawn (default: the Document). A nodeIds scope draws only those Nodes and what they contain, and no Artboard backgrounds. */
  scope?: RenderScope;
  /** A colour filling the whole rect beneath everything. */
  background?: string;
  /** Render Overlays drawn over the artwork, sized in pixels at `scale` (ADR-0014). */
  overlays?: RenderOverlay[];
  scale?: number;
}

/** Which Nodes a walk draws: all of them, or those inside `scope`. */
interface Walk {
  scope: Set<string> | undefined;
  inside: boolean;
  /** Collects the Nodes drawn, but Layers, for the overlays. */
  drawn: Node[];
}

const NS = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:inkscape": "http://www.inkscape.org/namespaces/inkscape",
  "xmlns:sodipodi": "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "xmlns:zibel": "https://zibel.dev/ns/svg",
};

const scopeName = (scope?: RenderScope) =>
  !scope
    ? "doc"
    : "artboardId" in scope
      ? `artboard:${scope.artboardId}`
      : "nodeIds" in scope
        ? `nodes:${scope.nodeIds.join(",")}`
        : `rect:${[scope.rect.x, scope.rect.y, scope.rect.width, scope.rect.height].join(",")}`;

/**
 * SVG of `rect` in document coordinates, in Inkscape's dialect (ADR-0017): `render` and `export`
 * both write it. The default rect is what an SVG `export` of the scope covers.
 */
export function toSvg(doc: Document, rect?: Rect, opts: SvgOptions = {}): string {
  const { scope } = opts;
  const { x, y, width, height } = rect ?? svgRect(doc, scope);
  const nodeIds = scope && "nodeIds" in scope ? new Set(scope.nodeIds) : undefined;
  // Inkscape resizes the page at (0,0) to the viewBox, so a file carries only the pages that fit
  // it: every Artboard at doc scope, one at artboard scope, none for a selection or a rect.
  const pages = !scope
    ? doc.artboards
    : "artboardId" in scope
      ? doc.artboards.filter((a) => a.id === scope.artboardId)
      : [];
  const namedview = pages.length
    ? `<sodipodi:namedview inkscape:document-units="pt">${pages
        .map(
          (a) =>
            `<inkscape:page${attrs({ ...a.frame, id: `z-${a.id}`, "inkscape:label": a.name })}/>`,
        )
        .join("")}</sodipodi:namedview>`
    : `<sodipodi:namedview inkscape:document-units="pt"/>`;
  const background = [
    opts.background ? `<rect${attrs({ x, y, width, height, fill: opts.background })}/>` : "",
    ...(nodeIds ? [] : doc.artboards)
      .filter((a) => a.background)
      .map(
        (a) =>
          `<rect${attrs({ ...a.frame, fill: a.background, "zibel:artboard": a.id, "sodipodi:insensitive": "true" })}/>`,
      ),
  ].join("");
  const drawn: Node[] = [];
  const body = childrenOf(doc, null)
    .map((n) => node(doc, n, { scope: nodeIds, inside: !nodeIds, drawn }))
    .join("");
  const overlay = opts.overlays?.length
    ? overlays(doc, drawn, new Set(opts.overlays), opts.scale ?? 1)
    : "";
  const root = attrs({
    ...NS,
    width: `${width}pt`,
    height: `${height}pt`,
    viewBox: `${x} ${y} ${width} ${height}`,
    "zibel:doc": doc.id,
    "zibel:rev": doc.rev,
    "zibel:scope": scopeName(scope),
  });
  return `<svg${root}>${namedview}${background}${body}${overlay}</svg>`;
}

// Magenta boxes and labels, cyan Artboard edges: colours artwork rarely uses, and neither is the
// default black Stroke.
const BOX = "#FF00FF";
const EDGE = "#00AEEF";

/** Artboard edges, then boxes, then id labels on top, each a fixed pixel size at `scale`. */
function overlays(doc: Document, drawn: Node[], on: Set<RenderOverlay>, scale: number): string {
  const px = (v: number) => formatNumber(v / scale);
  const outline = (r: Rect, stroke: string) =>
    `<rect${attrs({
      x: formatNumber(r.x),
      y: formatNumber(r.y),
      width: formatNumber(r.width),
      height: formatNumber(r.height),
      fill: "none",
      stroke,
      "stroke-width": px(1),
    })}/>`;
  const boxes = drawn.flatMap((n) => {
    const b = bounds(doc, n);
    return b ? [{ n, b }] : [];
  });
  // Inside the top-left corner, so a Node at the image's edge keeps its label; a white halo
  // under the text reads on any colour.
  const label = ({ n, b }: { n: Node; b: Rect }) =>
    [
      { fill: "none", stroke: "#FFFFFF", "stroke-width": px(3), "stroke-linejoin": "round" },
      { fill: BOX },
    ]
      .map(
        (paint) =>
          `<text${attrs({
            x: formatNumber(b.x + 2 / scale),
            y: formatNumber(b.y + 11 / scale),
            "font-family": "Source Sans 3",
            "font-size": px(11),
            ...paint,
          })}>${esc(n.id)}</text>`,
      )
      .join("");
  return [
    ...(on.has("artboards") ? doc.artboards.map((a) => outline(a.frame, EDGE)) : []),
    ...(on.has("bounds") ? boxes.map(({ b }) => outline(b, BOX)) : []),
    ...(on.has("ids") ? boxes.map(label) : []),
  ].join("");
}

function node(doc: Document, n: Node, walk: Walk): string {
  if (!n.visible) return "";
  const inside = walk.inside || walk.scope?.has(n.id) === true;
  if (inside && n.type !== "layer") walk.drawn.push(n);
  const group = {
    opacity: n.opacity === 1 ? undefined : n.opacity,
    transform: n.transform.every((v, i) => v === IDENTITY[i])
      ? undefined
      : `matrix(${n.transform.map(formatNumber).join(" ")})`,
  };
  if (n.type === "layer" || n.type === "group") {
    const kids = childrenOf(doc, n.id)
      .map((c) => node(doc, c, { ...walk, inside }))
      .join("");
    // Outside the scope, a container is drawn only as the way to a listed Node.
    return inside || kids ? `<g${attrs(group)}>${kids}</g>` : "";
  }
  if (!inside) return "";
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
