import { DOMParser, type Element } from "@xmldom/xmldom";
import {
  type Appearance,
  type Artboard,
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
  transformSegments,
  type WriteReceipt,
  ZibelError,
} from "@zibel/core";
import { generateKeyBetween } from "fractional-indexing";

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
      matrix: () =>
        numbers(args ?? "")
          .concat(IDENTITY)
          .slice(0, 6) as Matrix,
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

/** Where the walk is: the Node children go into, and the matrix from here to the Document. */
interface Context {
  /** A Layer or Group id; null at the root, where loose content goes into a Layer of its own. */
  parentId: string | null;
  /** The parent is the root or a Layer, so an Inkscape layer here is a Layer. */
  layerLevel: boolean;
  matrix: Matrix;
}

/** Everything one SVG file gives a Document, as the walk builds it. */
class Reader {
  readonly nodes: Node[] = [];
  readonly warnings = new Map<string, Warning>();
  private readonly last = new Map<string | null, string | null>();
  private readonly ids = new Set<string>();
  /** The Layer loose root content goes into, made at the first such element. */
  private loose: string | undefined;

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
  private id(e: Element | null) {
    const kept = ULID.exec(e?.getAttribute("id") ?? "")?.[1];
    const id = kept && !this.ids.has(kept) ? kept : newId();
    this.ids.add(id);
    return id;
  }

  /** The properties every Node has, placed under `parentId`. */
  base(e: Element | null, parentId: string | null, name = "") {
    return {
      id: this.id(e),
      name,
      parentId,
      index: this.index(parentId),
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      transform: [...IDENTITY] as Matrix,
      tags: [] as string[],
      meta: {} as Record<string, unknown>,
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
    const matrix = multiply(ctx.matrix, parseTransform(e.getAttribute("transform")));
    const tag = e.localName;
    if (tag === "g" || tag === "a" || tag === "switch") {
      const layer = ctx.layerLevel && e.getAttributeNS(INKSCAPE_NS, "groupmode") === "layer";
      const parentId = layer ? ctx.parentId : this.parent(ctx);
      const node = this.add({ ...this.base(e, parentId), type: layer ? "layer" : "group" });
      for (const c of elements(e)) this.walk(c, { parentId: node.id, layerLevel: layer, matrix });
      return;
    }
    const shape = this.shape(e, matrix);
    if (!shape) return;
    const appearance: Appearance = { fills: [{ type: "solid", color: "#000000" }], strokes: [] };
    this.add({ ...this.base(e, this.parent(ctx)), ...shape, appearance } as Node);
  }

  /** A shape element's parameters in document coordinates, with the transform it keeps. */
  private shape(e: Element, m: Matrix): Record<string, unknown> | null {
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
      case "path":
        return path(normalizePath(e.getAttribute("d") ?? "", "d"));
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

  const reader = new Reader();
  const matrix: Matrix = [scale, 0, 0, scale, 0, 0];
  for (const e of elements(root)) reader.walk(e, { parentId: null, layerLevel: true, matrix });
  // parseDocument wants a Layer at the root, even for a file with nothing in it.
  if (!reader.nodes.some((n) => n.type === "layer" && n.parentId === null))
    reader.parent({ parentId: null, layerLevel: true, matrix });
  const artboards: Artboard[] = [
    {
      id: newId(),
      name: "Artboard 1",
      frame: { x: n3(frame.x), y: n3(frame.y), width: n3(frame.width), height: n3(frame.height) },
    },
  ];

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
