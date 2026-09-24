import { DOMParser, type Element } from "@xmldom/xmldom";
import {
  type Appearance,
  type Artboard,
  BlendMode,
  BUNDLED_FONT,
  cssColor,
  formatPath,
  IDENTITY,
  type Matrix,
  MIGRATIONS,
  multiply,
  type Node,
  newId,
  normalizePath,
  parseDocument,
  round,
  type Segment,
  textBox,
  transformSegments,
  type WriteReceipt,
  ZibelError,
} from "@zibel/core";
import { generateKeyBetween } from "fractional-indexing";
import { computeStyle, type Rule, type Style, stylesheet } from "./style.ts";

export type Warning = WriteReceipt["warnings"][number];

/** A file read for Open: a Document's contents without its docId, and what did not come across. */
export interface OpenedFile {
  name: string;
  artboards: Artboard[];
  nodes: Node[];
  warnings: Warning[];
}

export const SVG_NS = "http://www.w3.org/2000/svg";
export const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
export const SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const ZIBEL_NS = "https://zibel.dev/ns/svg";

const invalid = (message: string) =>
  new ZibelError({
    code: "INVALID_DOCUMENT",
    message,
    hint: "Pass the text of a well-formed SVG file, as Inkscape or zibel_export writes it.",
    path: "content",
  });

/** pt per unit (CSS Values 4). px is one pt, as Illustrator opens SVG, not Inkscape's 0.75. */
const UNITS: Record<string, number> = {
  "": 1,
  px: 1,
  pt: 1,
  pc: 12,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  q: 72 / 101.6,
};

/** A length in pt, or undefined when it is missing, relative (%, em) or not a length. */
export function length(value: string | null | undefined): number | undefined {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z]*)\s*$/i.exec(value ?? "");
  const unit = UNITS[(m?.[2] ?? "").toLowerCase()];
  return m && unit !== undefined ? Number(m[1]) * unit : undefined;
}

/** At most 3 decimals and no -0, as the Document stores numbers (REQUIREMENTS §6.5). */
export const n3 = (n: number) => Math.round(n * 1000) / 1000 || 0;

const numbers = (s: string | null) =>
  (s ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);

const elements = (e: Element) =>
  [...(e.childNodes as unknown as Iterable<{ nodeType: number }>)].filter(
    (c): c is Element => c.nodeType === 1,
  );

/** An SVG transform list as one matrix, applied right to left as SVG does. */
export function parseTransform(list: string | null): Matrix {
  let m: Matrix = [...IDENTITY] as Matrix;
  for (const [, fn, args] of (list ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const [a = 0, b, c] = numbers(args ?? "");
    const rad = (a * Math.PI) / 180;
    const step: Record<string, () => Matrix> = {
      matrix: () => {
        const m = numbers(args ?? "");
        return (m.length === 6 ? m : Array(6).fill(Number.NaN)) as Matrix;
      },
      translate: () => [1, 0, 0, 1, a, b ?? 0],
      scale: () => [a, 0, 0, b ?? a, 0, 0],
      rotate: () => {
        const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
        const [cx, cy] = [b ?? 0, c ?? 0];
        return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
      },
      skewX: () => [1, 0, Math.tan(rad), 1, 0, 0],
      skewY: () => [1, Math.tan(rad), 0, 1, 0, 0],
    };
    const make = step[fn ?? ""];
    if (make) m = multiply(m, make());
  }
  return m;
}

/** A move and a uniform scale, which Live Shape parameters can absorb (ADR-0017). */
const bakes = ([a, b, c, d]: Matrix) =>
  Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && a > 0 && Math.abs(a - d) < 1e-9;

const ULID = /^z-([0-9A-HJKMNP-TV-Z]{26})$/;

/** Elements that draw, and those that only define or describe and are skipped without a word. */
const DRAWN = new Set([
  "g",
  "a",
  "switch",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
]);
const SILENT = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "style",
  "symbol",
  "linearGradient",
  "radialGradient",
  "pattern",
  "clipPath",
  "mask",
  "filter",
  "marker",
]);

/** Where the walk is: the Node children go into, and the matrix from here to the Document. */
interface Context {
  /** A Layer or Group id; null at the root, where loose content goes into a Layer of its own. */
  parentId: string | null;
  /** The parent is the root or a Layer, so an Inkscape layer here is a Layer. */
  layerLevel: boolean;
  matrix: Matrix;
  style: Style;
  /** How many Layers and Groups enclose it. */
  depth: number;
}

/**
 * The deepest Layer and Group nesting Open reads. Deeper files are refused: the walk, and core's
 * walks after it, recurse (REQUIREMENTS §6.7).
 */
export const MAX_DEPTH = 256;

/** An opacity from `0.5` or `50%`, 1 when missing or unreadable. */
const alpha = (v: string | undefined) => {
  const n = v?.trim().endsWith("%") ? Number.parseFloat(v) / 100 : Number(v ?? 1);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
};

/** `hex` with its own alpha times `a`, as #RRGGBB when opaque. */
function withAlpha(hex: string, a: number): string {
  const own = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  const byte = Math.round(own * a * 255);
  return byte >= 255
    ? hex.slice(0, 7)
    : `${hex.slice(0, 7)}${byte.toString(16).padStart(2, "0").toUpperCase()}`;
}

const CAPS = ["butt", "round", "square"];
const JOINS = ["miter", "round", "bevel"];

/** Everything one SVG file gives a Document, as the walk builds it. */
class Reader {
  readonly nodes: Node[] = [];
  readonly warnings = new Map<string, Warning>();
  private readonly last = new Map<string | null, string | null>();
  private readonly ids = new Set<string>();

  /** The Layer loose root content goes into, made at the first such element. */
  private loose: string | undefined;

  constructor(
    private readonly rules: Rule[],
    private readonly byId: Map<string, Element>,
    private readonly artboards: Artboard[],
  ) {}

  warn(code: string, key: string, message: string, nodeId?: string) {
    const id = `${code} ${key}`;
    if (!this.warnings.has(id)) this.warnings.set(id, { code, message, ...(nodeId && { nodeId }) });
  }

  /** The next sibling index under `parentId`, as createNodes gives them. */
  index(parentId: string | null) {
    const index = generateKeyBetween(this.last.get(parentId) ?? null, null);
    this.last.set(parentId, index);
    return index;
  }

  /** A `z-<ULID>` id comes back as that Node's; any other id is a new Node (ADR-0017). */
  private id(e: Element | null, again = false) {
    const kept = ULID.exec(e?.getAttribute("id") ?? "")?.[1];
    if (kept && this.ids.has(kept) && !again) {
      this.warn(
        "DUPLICATE_ID",
        "",
        `Two elements have the id z-${kept}; the second is a new Node.`,
      );
    }
    const id = kept && !this.ids.has(kept) ? kept : newId();
    this.ids.add(id);
    return id;
  }

  /** `zibel:tags` and `zibel:meta` as export writes them, or empty with a warning. */
  private tagsAndMeta(e: Element | null) {
    const read = (name: string, ok: (v: unknown) => boolean) => {
      const raw = e?.getAttributeNS(ZIBEL_NS, name);
      if (!raw) return undefined;
      try {
        const v = JSON.parse(raw);
        if (ok(v)) return v;
      } catch {}
      this.warn(
        "INVALID_TAGS_META",
        "",
        `zibel:${name} is not the JSON export writes; it was dropped.`,
      );
      return undefined;
    };
    const tags = read("tags", (v) => Array.isArray(v) && v.every((t) => typeof t === "string"));
    const meta = read("meta", (v) => !!v && typeof v === "object" && !Array.isArray(v));
    return { tags: (tags ?? []) as string[], meta: (meta ?? {}) as Record<string, unknown> };
  }

  /** The properties every Node has, placed under `parentId`. */
  base(
    e: Element | null,
    parentId: string | null,
    name?: string,
    style: Style = {},
    again = false,
  ) {
    const blend = BlendMode.safeParse(style["mix-blend-mode"]);
    return {
      id: this.id(e, again),
      name: name ?? e?.getAttributeNS(INKSCAPE_NS, "label") ?? "",
      parentId,
      index: this.index(parentId),
      visible: style.display !== "none",
      // Inkscape writes "true", older files "1": any value locks.
      locked: e?.hasAttributeNS(SODIPODI_NS, "insensitive") ?? false,
      opacity: alpha(style.opacity),
      blendMode: blend.success ? blend.data : ("normal" as const),
      transform: [...IDENTITY] as Matrix,
      ...this.tagsAndMeta(e),
    };
  }

  add<T extends Node>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** The parent for a Node found at `ctx`: at the root, the Layer for loose content. */
  parent(ctx: Context): string {
    if (ctx.parentId) return ctx.parentId;
    this.loose ??= this.add({ ...this.base(null, null, "Layer 1"), type: "layer" }).id;
    return this.loose;
  }

  walk(e: Element, ctx: Context) {
    if (e.namespaceURI !== SVG_NS && e.namespaceURI !== null) return;
    if (SILENT.has(e.localName ?? "")) return;
    if (!DRAWN.has(e.localName ?? "")) {
      this.warn(
        "UNSUPPORTED_ELEMENT",
        e.localName ?? "",
        `<${e.localName}> is not supported yet and was dropped.`,
      );
      return;
    }
    let own = parseTransform(e.getAttribute("transform"));
    // An unreadable transform is ignored, as SVG does; one that flattens the element to a line
    // or point draws nothing, and a Node cannot carry it.
    if (!own.every(Number.isFinite)) {
      this.warn("INVALID_TRANSFORM", "nan", "An unreadable transform was ignored.");
      own = [...IDENTITY] as Matrix;
    } else if (Math.abs(own[0] * own[3] - own[1] * own[2]) < 1e-12) {
      this.warn("INVALID_TRANSFORM", "flat", "An element scaled to nothing was dropped.");
      return;
    }
    const matrix = multiply(ctx.matrix, own);
    const style = computeStyle(e, ctx.style, this.rules);
    const tag = e.localName;
    const stack = e.getAttributeNS(ZIBEL_NS, "stack") === "true";
    if (e.getAttributeNS(SODIPODI_NS, "type") === "inkscape:box3d") {
      this.warn("BOX3D_AS_PATHS", "", "3D boxes import as a Group of their side Paths.");
    }
    if ((tag === "g" && !stack) || tag === "a" || tag === "switch") {
      if (ctx.depth >= MAX_DEPTH) {
        throw new ZibelError({
          code: "LIMIT_EXCEEDED",
          message: `Groups in the file nest deeper than ${MAX_DEPTH} levels.`,
          hint: "Ungroup the innermost levels in the editor that made the file, then open it again.",
          path: "content",
        });
      }
      // A container's clipping, mask or filter is lost like a leaf's.
      this.unsupported(e, style);
      const layer = ctx.layerLevel && e.getAttributeNS(INKSCAPE_NS, "groupmode") === "layer";
      const parentId = layer ? ctx.parentId : this.parent(ctx);
      const node = this.add({
        ...this.base(e, parentId, undefined, style),
        type: layer ? "layer" : "group",
      });
      for (const c of elements(e)) {
        this.walk(c, { parentId: node.id, layerLevel: layer, matrix, style, depth: ctx.depth + 1 });
      }
      return;
    }
    // An Artboard's background, or the export's background option: not artwork.
    const artboardId = e.getAttributeNS(ZIBEL_NS, "artboard");
    if (artboardId) {
      const artboard = this.artboards.find((a) => a.id === artboardId);
      const fill = this.paint(style.fill ?? "black", style, style["fill-opacity"]);
      if (artboard && fill) artboard.background = fill;
      return;
    }
    if (e.getAttributeNS(ZIBEL_NS, "background")) return;
    /** What Stroke widths scale by: the leaf's scale when it bakes into the parameters. */
    const scaleOf = (m: Matrix) => (bakes(m) ? m[0] : 1);
    type Piece = { shape: Record<string, unknown> | null; appearance: Appearance };
    let pieces: Piece[];
    if (stack) {
      // One Node painted several times: its geometry from the first paint, its Fills, then its
      // Strokes, in order (ADR-0017).
      const paints = elements(e).map((c) => {
        const s = computeStyle(c, style, this.rules);
        const m = multiply(matrix, parseTransform(c.getAttribute("transform")));
        return { shape: this.shape(c, m, s), look: this.appearance(s, scaleOf(this.placed(c, m))) };
      });
      pieces = [
        {
          shape: paints.find((p) => p.shape)?.shape ?? null,
          appearance: {
            fills: paints.flatMap((p) => p.look.fills),
            strokes: paints.flatMap((p) => p.look.strokes),
          },
        },
      ];
    } else if (tag === "text") {
      // Point Type is one line, so each Inkscape line is a Node of its own.
      pieces = this.lines(e, style).map((line) => ({
        shape: this.text(line, line.style, matrix),
        appearance: this.appearance(line.style, scaleOf(matrix)),
      }));
    } else {
      const appearance = this.appearance(style, scaleOf(this.placed(e, matrix)));
      pieces = [{ shape: this.shape(e, matrix, style), appearance }];
    }
    pieces = pieces.filter((p) => p.shape);
    if (pieces.length) this.unsupported(e, style);
    pieces.forEach(({ shape, appearance }, i) => {
      // A text's later lines are new Nodes, not duplicates of its id.
      const base = this.base(e, this.parent(ctx), undefined, style, i > 0);
      // visibility inherits, unlike display, so it hides a leaf rather than its Group.
      if (style.visibility === "hidden" || style.visibility === "collapse") base.visible = false;
      this.add({ ...base, ...shape, appearance } as Node);
    });
  }

  /** What a leaf's style asks for that Zibel draws without: warned, then left out. */
  private unsupported(e: Element, style: Style) {
    for (const p of ["clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"]) {
      if (style[p] && style[p] !== "none") {
        this.warn(
          "UNSUPPORTED_ATTRIBUTE",
          p,
          `${p} is not supported yet; the artwork imports without it.`,
        );
      }
    }
    if (style["fill-rule"] === "evenodd") {
      this.warn(
        "UNSUPPORTED_ATTRIBUTE",
        "fill-rule",
        "fill-rule evenodd is not supported until Compound Paths land (#30); nonzero is used.",
      );
    }
    if (e.hasAttributeNS(INKSCAPE_NS, "path-effect")) {
      this.warn(
        "PATH_EFFECT_FLATTENED",
        "",
        "Live Path Effects import as the Path they draw; the effect is dropped.",
      );
    }
  }

  /** The lines of a <text>: Inkscape's line tspans, else the whole text as one. */
  private lines(e: Element, style: Style) {
    const preserve = e.getAttribute("xml:space") === "preserve";
    const clean = (t: string) =>
      preserve ? t.replace(/[\t\n\r]/g, " ") : t.replace(/\s+/g, " ").trim();
    const first = (el: Element, name: string) => numbers(el.getAttribute(name))[0];
    const [x = 0, y = 0] = [first(e, "x"), first(e, "y")];
    const tspans = elements(e).filter(
      (c) => c.localName === "tspan" && c.getAttributeNS(SODIPODI_NS, "role") === "line",
    );
    const lines = tspans.length
      ? tspans.map((t) => ({
          x: first(t, "x") ?? x,
          y: first(t, "y") ?? y,
          content: clean(t.textContent ?? ""),
          style: computeStyle(t, style, this.rules),
        }))
      : [{ x, y, content: clean(e.textContent ?? ""), style }];
    return lines.filter((l) => l.content);
  }

  /** One line of Point Type, its start moved for text-anchor by its measured width. */
  private text(line: { x: number; y: number; content: string }, style: Style, m: Matrix) {
    const bake = bakes(m);
    const [k, , , , tx, ty] = bake ? m : IDENTITY;
    const fontSize = n3((length(style["font-size"]) ?? 12) * k);
    const family = style["font-family"]
      ?.split(",")[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "");
    const { content } = line;
    let x = k * line.x + tx;
    const anchor = style["text-anchor"];
    if (anchor === "middle" || anchor === "end") {
      const width = textBox({ x: 0, y: 0, content, fontSize }).width;
      x -= anchor === "middle" ? width / 2 : width;
    }
    return {
      type: "text",
      kind: "point",
      x: n3(x),
      y: n3(k * line.y + ty),
      content,
      fontFamily: family || BUNDLED_FONT,
      fontSize,
      transform: bake ? [...IDENTITY] : round(m),
    };
  }

  /** Fills and Strokes from resolved style, SVG's defaults where it says nothing. */
  private appearance(style: Style, k: number): Appearance {
    const fill = this.paint(style.fill ?? "black", style, style["fill-opacity"]);
    const stroke = this.paint(style.stroke ?? "none", style, style["stroke-opacity"]);
    const width = n3((length(style["stroke-width"]) ?? 1) * k);
    const join = JOINS.includes(style["stroke-linejoin"] ?? "")
      ? style["stroke-linejoin"]
      : "miter";
    const limit = Number(style["stroke-miterlimit"]);
    let dash = (style["stroke-dasharray"] ?? "none")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((v) => length(v) ?? Number.NaN);
    if (dash.some((v) => !(v >= 0)) || dash.every((v) => v === 0)) dash = [];
    // An odd list repeats to make it even (SVG 1.1 §11.4).
    if (dash.length % 2) dash = [...dash, ...dash];
    return {
      fills: fill ? [{ type: "solid", color: fill }] : [],
      strokes:
        stroke && width > 0
          ? [
              {
                color: stroke,
                width,
                cap: (CAPS.includes(style["stroke-linecap"] ?? "")
                  ? style["stroke-linecap"]
                  : "butt") as "butt",
                join: join as "miter",
                // SVG's default limit is 4, where it shows; for other joins, Zibel's 10.
                miterLimit: limit >= 1 ? Math.min(limit, 500) : join === "miter" ? 4 : 10,
                dash: dash.map((v) => n3(v * k)),
              },
            ]
          : [],
    };
  }

  /** A fill or stroke value as a colour, or null for none. A gradient gives its first stop. */
  private paint(value: string, style: Style, opacity: string | undefined): string | null {
    const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(value.trim());
    let hex: string | null;
    if (url) {
      const stop = this.firstStop(url[1] ?? "");
      hex = stop ?? cssColor(url[2] ?? "");
      if (stop) {
        this.warn(
          "GRADIENT_FLATTENED",
          "",
          "Gradients are solid Fills and Strokes in their first stop's colour until gradients land (#22).",
        );
      } else if (!hex) {
        this.warn("UNSUPPORTED_PAINT", "", "Patterns and unknown paint servers are dropped.");
      }
    } else if (value.trim().toLowerCase() === "currentcolor")
      hex = cssColor(style.color ?? "black");
    else hex = cssColor(value);
    return hex && withAlpha(hex, alpha(opacity));
  }

  /** The first stop's colour of a gradient, following href to the gradient that has the stops. */
  private firstStop(id: string, depth = 0): string | null {
    const g = this.byId.get(id);
    if (!g || !/Gradient$/.test(g.localName ?? "") || depth > 8) return null;
    const stop = elements(g).find((c) => c.localName === "stop");
    if (stop) {
      const s = computeStyle(stop, {}, this.rules);
      const hex = cssColor(s["stop-color"] ?? "black");
      return hex && withAlpha(hex, alpha(s["stop-opacity"]));
    }
    const href = g.getAttribute("href") ?? g.getAttributeNS(XLINK_NS, "href");
    return href?.startsWith("#") ? this.firstStop(href.slice(1), depth + 1) : null;
  }

  /**
   * An Inkscape star or polygon that a Live Shape holds (ADR-0017): its parameters, and the turn
   * of its first vertex away from straight up. Anything else reads as the Path its d draws.
   */
  private star(e: Element) {
    const type = e.getAttributeNS(SODIPODI_NS, "type");
    if (type === "arc") {
      this.warn(
        "ARC_AS_PATH",
        "",
        "Ellipse arcs and slices import as Paths until the ellipse gains angles.",
      );
    }
    if (type !== "star") return undefined;
    const at = (name: string) => Number(e.getAttributeNS(SODIPODI_NS, name));
    const sides = at("sides");
    const [arg1, arg2] = [at("arg1"), at("arg2")];
    const flat = e.getAttributeNS(INKSCAPE_NS, "flatsided") === "true";
    const shaped =
      Number(e.getAttributeNS(INKSCAPE_NS, "rounded") || 0) !== 0 ||
      Number(e.getAttributeNS(INKSCAPE_NS, "randomized") || 0) !== 0 ||
      (!flat && Math.abs(arg2 - arg1 - Math.PI / sides) > 1e-6);
    const params = { cx: at("cx"), cy: at("cy"), r1: at("r1"), r2: at("r2") };
    const valid =
      Number.isInteger(sides) &&
      sides >= 3 &&
      sides <= 1000 &&
      Number.isFinite(arg1) &&
      Number.isFinite(params.cx) &&
      Number.isFinite(params.cy) &&
      params.r1 >= 0 &&
      params.r2 >= 0;
    if (shaped || !valid) {
      this.warn(
        "STAR_AS_PATH",
        "",
        "Rounded, randomized or twisted stars import as Paths until stars gain those parameters.",
      );
      return undefined;
    }
    const turn = arg1 + Math.PI / 2;
    return {
      ...params,
      sides,
      flat,
      turn:
        Math.abs(turn) < 1e-6
          ? ([...IDENTITY] as Matrix)
          : parseTransform(`rotate(${(turn * 180) / Math.PI} ${params.cx} ${params.cy})`),
    };
  }

  /** The matrix a leaf is drawn with: its ancestors' and its own, and a star's turn. */
  private placed(e: Element, outer: Matrix): Matrix {
    const star = e.localName === "path" ? this.star(e) : undefined;
    // A star turned in Inkscape keeps its turn as a matrix about its centre, as Zibel writes it.
    return star ? multiply(outer, star.turn) : outer;
  }

  /** A shape element's parameters in document coordinates, with the transform it keeps. */
  private shape(e: Element, outer: Matrix, style: Style): Record<string, unknown> | null {
    if (e.localName === "text") {
      const [line] = this.lines(e, style);
      return line ? this.text(line, line.style, outer) : null;
    }
    const star = e.localName === "path" ? this.star(e) : undefined;
    const m = this.placed(e, outer);
    const num = (name: string) => length(e.getAttribute(name)) ?? 0;
    const bake = bakes(m);
    const [k, , , , tx, ty] = bake ? m : IDENTITY;
    const x = (v: number) => n3(k * v + tx);
    const y = (v: number) => n3(k * v + ty);
    const size = (v: number) => n3(k * v);
    const transform = bake ? [...IDENTITY] : round(m);
    const path = (segments: Segment[]) => ({
      type: "path",
      d: formatPath(bake ? transformSegments(segments, m) : segments),
      transform,
    });
    switch (e.localName) {
      case "rect": {
        const rx = length(e.getAttribute("rx")) ?? length(e.getAttribute("ry")) ?? 0;
        const ry = length(e.getAttribute("ry")) ?? rx;
        return {
          type: "rect",
          x: x(num("x")),
          y: y(num("y")),
          width: size(num("width")),
          height: size(num("height")),
          radius: size(Math.min(rx, ry)),
          transform,
        };
      }
      case "circle":
      case "ellipse": {
        const rx = e.localName === "circle" ? num("r") : num("rx");
        const ry = e.localName === "circle" ? num("r") : num("ry");
        return {
          type: "ellipse",
          x: x(num("cx") - rx),
          y: y(num("cy") - ry),
          width: size(2 * rx),
          height: size(2 * ry),
          transform,
        };
      }
      case "line":
        return {
          type: "line",
          x1: x(num("x1")),
          y1: y(num("y1")),
          x2: x(num("x2")),
          y2: y(num("y2")),
          transform,
        };
      case "polyline":
      case "polygon": {
        const p = numbers(e.getAttribute("points"));
        if (p.length < 4) return null;
        const segments: Segment[] = [];
        for (let i = 0; i + 1 < p.length; i += 2) {
          segments.push({ cmd: i ? "L" : "M", args: [p[i] as number, p[i + 1] as number] });
        }
        if (e.localName === "polygon") segments.push({ cmd: "Z", args: [] });
        return path(segments);
      }
      case "path": {
        if (!star) {
          try {
            return path(normalizePath(e.getAttribute("d") ?? "", "d"));
          } catch (error) {
            if (!(error instanceof ZibelError)) throw error;
            this.warn("INVALID_PATH", "", `A path was dropped: ${error.message}`);
            return null;
          }
        }
        const { cx, cy, r1, r2, sides } = star;
        const centre = { cx: x(cx), cy: y(cy) };
        return star.flat
          ? { type: "polygon", ...centre, radius: size(r1), sides, transform }
          : {
              type: "star",
              ...centre,
              outerRadius: size(r1),
              innerRadius: size(r2),
              points: sides,
              transform,
            };
      }
      default:
        return null;
    }
  }
}

/** Reads SVG text into a Document's contents (ADR-0017). */
export function parseSvg(text: string, nameHint?: string): OpenedFile {
  let error: string | undefined;
  let dom: ReturnType<DOMParser["parseFromString"]>;
  try {
    dom = new DOMParser({
      onError: (level, message) => {
        if (level === "warning") return;
        error ??= message.split("\n")[0];
        throw new Error(message);
      },
    }).parseFromString(text, "image/svg+xml");
  } catch (e) {
    throw invalid(`Not well-formed XML: ${error ?? (e as Error).message}`);
  }
  const root = dom.documentElement;
  if (!root || root.localName !== "svg") throw invalid("The file has no <svg> root element.");

  const width = length(root.getAttribute("width"));
  const height = length(root.getAttribute("height"));
  const vb = numbers(root.getAttribute("viewBox"));
  const [vx = 0, vy = 0, vw = 0, vh = 0] = vb;
  const hasViewBox = vb.length === 4 && vw > 0 && vh > 0;
  // User units to pt; the viewBox origin stays where it is, so a Zibel export's coordinates come
  // back unchanged.
  const scale = hasViewBox
    ? width !== undefined
      ? width / vw
      : height !== undefined
        ? height / vh
        : 1
    : 1;
  const frame = hasViewBox
    ? { x: vx * scale, y: vy * scale, width: vw * scale, height: vh * scale }
    : { x: 0, y: 0, width: width ?? 300, height: height ?? 150 };

  const all = [...(dom.getElementsByTagName("*") as unknown as Iterable<Element>)];
  const rules = stylesheet(
    all
      .filter((e) => e.localName === "style")
      .map((e) => e.textContent ?? "")
      .join("\n"),
  );
  const byId = new Map(
    all.flatMap((e) => (e.getAttribute("id") ? [[e.getAttribute("id") as string, e]] : [])),
  );
  // Inkscape's pages are in user units, like everything else; without any, the viewBox.
  const pages = all.filter((e) => e.namespaceURI === INKSCAPE_NS && e.localName === "page");
  const rect = (r: { x: number; y: number; width: number; height: number }) => ({
    x: n3(r.x),
    y: n3(r.y),
    width: n3(r.width),
    height: n3(r.height),
  });
  const artboards: Artboard[] = pages.length
    ? pages.map((p, i) => {
        const at = (name: string) => (length(p.getAttribute(name)) ?? 0) * scale;
        return {
          id: ULID.exec(p.getAttribute("id") ?? "")?.[1] ?? newId(),
          name: p.getAttributeNS(INKSCAPE_NS, "label") || `Artboard ${i + 1}`,
          frame: rect({ x: at("x"), y: at("y"), width: at("width"), height: at("height") }),
        };
      })
    : [{ id: newId(), name: "Artboard 1", frame: rect(frame) }];
  const reader = new Reader(rules, byId, artboards);
  const matrix: Matrix = [scale, 0, 0, scale, 0, 0];
  const ctx = { parentId: null, layerLevel: true, matrix, style: {}, depth: 0 };
  for (const e of elements(root)) reader.walk(e, ctx);
  // parseDocument wants a Layer at the root, even for a file with nothing in it.
  if (!reader.nodes.some((n) => n.type === "layer" && n.parentId === null)) reader.parent(ctx);

  const title = elements(root)
    .find((e) => e.localName === "title")
    ?.textContent?.trim();
  const docname = root.getAttributeNS(SODIPODI_NS, "docname")?.replace(/\.svg$/i, "");
  const hint = nameHint?.replace(/\.(svg|zibel\.json)$/i, "");
  const name = hint || docname || title || "Untitled";

  // Checked like any .zibel.json, so an importer bug fails the Open instead of storing a corrupt
  // Document.
  const file = parseDocument(
    JSON.stringify({ version: MIGRATIONS.length + 1, name, artboards, nodes: reader.nodes }),
  );
  return { ...file, warnings: [...reader.warnings.values()] };
}
