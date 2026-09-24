import {
  type Appearance,
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
  type ShapeNode,
  shapeSegments,
  union,
  visibleBounds,
  ZibelError,
} from "@zibel/core";

/** The longest side `render` and `export` rasterise (REQUIREMENTS §7). */
export const MAX_RENDER_SIDE = 4096;

// Whitespace as references too: an XML parser turns a raw newline in an attribute into a space.
const esc = (s: string) => s.replace(/[&<>"\t\n\r]/g, (c) => ESCAPES[c] ?? c);
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

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
  /** Inside a hidden Node: written, but not drawn. */
  hidden?: boolean;
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

const stroke = (s: Appearance["strokes"][number]): Attrs => ({
  stroke: s.color,
  "stroke-width": s.width,
  "stroke-linecap": s.cap === "butt" ? undefined : s.cap,
  "stroke-linejoin": s.join === "miter" ? undefined : s.join,
  // SVG's default miter limit is 4, Illustrator's is 10: always write it for miter joins.
  "stroke-miterlimit": s.join === "miter" ? s.miterLimit : undefined,
  "stroke-dasharray": s.dash.length > 0 ? s.dash.join(" ") : undefined,
});

const num = (a: Record<string, number>) =>
  Object.entries(a)
    .map(([k, v]) => ` ${k}="${formatNumber(v)}"`)
    .join("");

/** The element and geometry of a shape, as the Inkscape tool that draws it writes them. */
function shape(n: ShapeNode): string {
  switch (n.type) {
    case "rect": {
      const r = Math.min(n.radius, n.width / 2, n.height / 2);
      const { x, y, width, height } = n;
      return `rect${num({ x, y, width, height, ...(r > 0 && { rx: r, ry: r }) })}`;
    }
    case "ellipse": {
      const [rx, ry] = [n.width / 2, n.height / 2];
      const [cx, cy] = [n.x + rx, n.y + ry];
      return rx === ry ? `circle${num({ cx, cy, r: rx })}` : `ellipse${num({ cx, cy, rx, ry })}`;
    }
    case "line":
      return `line${num({ x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2 })}`;
    case "polygon":
    case "star": {
      // Inkscape's star tool rebuilds the outline from these on load, so d is the same vertices:
      // the first straight up (arg1, radians), the inner ones half a step clockwise (arg2).
      const [sides, r1, r2] =
        n.type === "polygon"
          ? [n.sides, n.radius, n.radius * Math.cos(Math.PI / n.sides)]
          : [n.points, n.outerRadius, n.innerRadius];
      const arg1 = -Math.PI / 2;
      return `path${attrs({
        "sodipodi:type": "star",
        "sodipodi:sides": sides,
        "sodipodi:cx": formatNumber(n.cx),
        "sodipodi:cy": formatNumber(n.cy),
        "sodipodi:r1": formatNumber(r1),
        "sodipodi:r2": formatNumber(r2),
        "sodipodi:arg1": arg1,
        "sodipodi:arg2": arg1 + Math.PI / sides,
        "inkscape:flatsided": String(n.type === "polygon"),
        "inkscape:rounded": 0,
        "inkscape:randomized": 0,
        d: formatPath(shapeSegments(n)),
      })}`;
    }
    default:
      // The same outline node_get reports as d.
      return `path d="${formatPath(shapeSegments(n))}"`;
  }
}

const style = (...parts: (string | false)[]) => parts.filter(Boolean).join(";") || undefined;

function node(doc: Document, n: Node, walk: Walk): string {
  // A hidden Node is written, so Inkscape shows it in the Layers panel, but never drawn.
  const hidden = walk.hidden || !n.visible;
  const inside = walk.inside || walk.scope?.has(n.id) === true;
  if (inside && !hidden && n.type !== "layer") walk.drawn.push(n);
  const own = {
    id: `z-${n.id}`,
    "inkscape:label": n.name || undefined,
    "sodipodi:insensitive": n.locked ? "true" : undefined,
    "zibel:tags": n.tags.length > 0 ? JSON.stringify(n.tags) : undefined,
    "zibel:meta": Object.keys(n.meta).length > 0 ? JSON.stringify(n.meta) : undefined,
    transform: n.transform.every((v, i) => v === IDENTITY[i])
      ? undefined
      : `matrix(${n.transform.map(formatNumber).join(" ")})`,
  };
  const looks = [
    !n.visible && "display:none",
    n.opacity !== 1 && `opacity:${n.opacity}`,
    n.blendMode !== "normal" && `mix-blend-mode:${n.blendMode}`,
  ] as const;
  if (n.type === "layer" || n.type === "group") {
    const kids = childrenOf(doc, n.id)
      .map((c) => node(doc, c, { ...walk, inside, hidden }))
      .join("");
    const layer = n.type === "layer" ? { "inkscape:groupmode": "layer" } : {};
    // Outside the scope, a container is written only as the way to a listed Node.
    return inside || kids
      ? `<g${attrs({ ...own, ...layer, style: style(...looks) })}>${kids}</g>`
      : "";
  }
  if (!inside) return "";
  // Text is kerned off:
  // resvg honours font-kerning only as a style, and unkerned the drawn width is the advance sum the
  // bounds report (ADR-0013).
  const text = n.type === "text";
  const element = (a: Attrs, extra: (string | false)[] = []) =>
    text
      ? `<text${attrs({
          x: n.x,
          y: n.y,
          "font-family": n.fontFamily,
          "font-size": n.fontSize,
          ...a,
          style: style(...extra, "font-kerning:none"),
          "xml:space": "preserve",
        })}>${esc(n.content)}</text>`
      : `<${shape(n)}${attrs({ ...a, style: style(...extra) })}/>`;
  const { fills, strokes } = n.appearance;
  // One Fill and one Stroke are one element, so Inkscape selects one object; a longer Appearance
  // is a <g zibel:stack> painting each Fill, then each Stroke: Illustrator's default stacking.
  if (fills.length <= 1 && strokes.length <= 1) {
    const [f] = fills;
    const [s] = strokes;
    return element({ ...own, fill: f?.color ?? "none", ...(s && stroke(s)) }, [...looks]);
  }
  const paints = [
    ...fills.map((f) => element({ fill: f.color })),
    ...strokes.map((s) => element({ fill: "none", ...stroke(s) })),
  ].join("");
  return `<g${attrs({ ...own, "zibel:stack": "true", style: style(...looks) })}>${paints}</g>`;
}
