import { DOMParser, type Element } from "@xmldom/xmldom";
import {
  type Artboard,
  IDENTITY,
  type Matrix,
  MIGRATIONS,
  type Node,
  newId,
  parseDocument,
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

/** Everything one SVG file gives a Document, as the walk builds it. */
class Reader {
  readonly nodes: Node[] = [];
  readonly warnings = new Map<string, Warning>();
  private readonly last = new Map<string | null, string | null>();

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

  layer(name: string): Node {
    const node: Node = {
      id: newId(),
      type: "layer",
      name,
      parentId: null,
      index: this.index(null),
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      transform: [...IDENTITY] as Matrix,
      tags: [],
      meta: {},
    };
    this.nodes.push(node);
    return node;
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
  reader.layer("Layer 1");
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
