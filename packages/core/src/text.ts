import type { Node, Rect, WriteReceipt } from "./schema.ts";
import { SOURCE_SANS_3 } from "./source-sans-3.ts";

/** Illustrator's weight names and their CSS `font-weight` (ADR-0028). */
export const FONT_WEIGHTS = {
  Thin: 100,
  ExtraLight: 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  Semibold: 600,
  Bold: 700,
  ExtraBold: 800,
  Black: 900,
} as const;
type WeightName = keyof typeof FONT_WEIGHTS;
/** A style name: a weight name, optionally followed by " Italic"; "Italic" alone is Regular Italic. */
export type FontStyle = WeightName | "Italic" | `${Exclude<WeightName, "Regular">} Italic`;
type BundledStyle = keyof typeof SOURCE_SANS_3.faces;

const italicOf = (name: WeightName): FontStyle =>
  name === "Regular" ? "Italic" : `${name} Italic`;
export const FONT_STYLES = (Object.keys(FONT_WEIGHTS) as WeightName[]).flatMap((w) => [
  w,
  italicOf(w),
]) as [FontStyle, ...FontStyle[]];

/** A style's CSS weight and italic. A text stored before ADR-0028 has no style and is Regular. */
export function fontFace(style: FontStyle = "Regular") {
  const italic = style.endsWith("Italic");
  const name = (style.replace(/ ?Italic$/, "") || "Regular") as WeightName;
  return { weight: FONT_WEIGHTS[name], italic };
}

/** The style name of a CSS weight, one of 100 to 900, and italic. */
export function fontStyleName(weight: number, italic: boolean): FontStyle {
  const name = (Object.keys(FONT_WEIGHTS) as WeightName[]).find((w) => FONT_WEIGHTS[w] === weight);
  if (!name) throw new Error(`No weight name for ${weight}.`);
  return italic ? italicOf(name) : name;
}

/** The bundled face a style draws in, by CSS font matching as resvg and browsers do (ADR-0028). */
export function bundledStyle(style?: FontStyle): BundledStyle {
  const { weight, italic } = fontFace(style);
  // ponytail: CSS matching over the bundled weights 400, 700 and 900 only; generalise it when a face
  // of another weight ships.
  return fontStyleName(weight <= 500 ? 400 : weight <= 700 ? 700 : 900, italic) as BundledStyle;
}

/** What lays out a text: its kind, anchor or frame, content and character attributes. */
interface TextLayout {
  kind?: "point" | "area";
  x: number;
  y: number;
  /** Area Type's frame; the schema requires both on Area Type (ADR-0022). */
  width?: number;
  height?: number;
  content: string;
  fontSize: number;
  fontStyle?: FontStyle | undefined;
  leading?: number | undefined;
}

/** One laid-out line: its characters and where its baseline starts. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}

type Face = { advances: Record<number, number>; notdef: number };

/** A string's advance sum in font units. */
function advance(text: string, { advances, notdef }: Face) {
  // ponytail: advance sum, no shaping or kerning; HarfBuzz (F-TEXT-09, M1) replaces this with
  // shaped glyph positions.
  let width = 0;
  for (const ch of text) width += advances[ch.codePointAt(0) as number] ?? notdef;
  return width;
}

/**
 * A text's lines (ADR-0022). Point Type breaks at hard returns, one leading apart from the baseline
 * origin `x, y`. Area Type wraps in its frame as Inkscape 1.2 draws it: each line keeps its trailing
 * spaces and hard return, so its lines and `overflow`, the text that does not fit, join back into
 * `content`.
 */
export function layoutText(text: TextLayout): { lines: TextLine[]; overflow: string } {
  const { x, y, content, fontSize } = text;
  const leading = text.leading ?? 1.2 * fontSize;
  const face: Face = SOURCE_SANS_3.faces[bundledStyle(text.fontStyle)];
  if (text.kind !== "area") {
    const lines = content.split("\n").map((t, i) => ({ text: t, x, y: y + i * leading }));
    return { lines, overflow: "" };
  }
  const { unitsPerEm, ascender, descender } = SOURCE_SANS_3;
  const { width = 0, height = 0 } = text;
  // Trailing spaces and the return hang past the frame's edge.
  const fits = (line: string) => (advance(line.trimEnd(), face) * fontSize) / unitsPerEm <= width;
  // ponytail: Inkscape's thresholds, measured rather than specified: a line shows while 90% of its
  // leading lies in the frame, and a word wider than the frame overflows with all that follows.
  const max = Math.max(0, Math.floor(height / leading - 0.9 + 1e-9) + 1);
  const wrapped: string[] = [];
  let used = 0;
  const push = (line: string) => {
    if (wrapped.length === max) return false;
    wrapped.push(line);
    used += line.length;
    return true;
  };
  wrap: for (const paragraph of content.split(/(?<=\n)/)) {
    let line = "";
    for (const word of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (line && !fits(line + word)) {
        if (!push(line)) break wrap;
        line = "";
      }
      if (!fits(word)) break wrap;
      line += word;
    }
    if (!push(line)) break;
  }
  // CSS half-leading around an em box of the ascender and descender scaled to one em, as Inkscape.
  const first = (leading - fontSize) / 2 + (fontSize * ascender) / (ascender - descender);
  return {
    lines: wrapped.map((t, i) => ({ text: t, x, y: y + first + i * leading })),
    overflow: content.slice(used),
  };
}

/**
 * A text's box: Area Type's frame; Point Type's from the baseline origin `x, y`, as wide as its
 * widest line and from the first line's ascender to the last line's descender (ADR-0013, ADR-0022).
 */
export function textBox(text: TextLayout): Rect {
  if (text.kind === "area") {
    return { x: text.x, y: text.y, width: text.width ?? 0, height: text.height ?? 0 };
  }
  const { unitsPerEm, ascender, descender } = SOURCE_SANS_3;
  const s = text.fontSize / unitsPerEm;
  const { lines } = layoutText(text);
  const face: Face = SOURCE_SANS_3.faces[bundledStyle(text.fontStyle)];
  const last = lines.at(-1) as TextLine;
  return {
    x: text.x,
    y: text.y - ascender * s,
    width: Math.max(...lines.map((l) => advance(l.text, face))) * s,
    height: last.y - text.y + (ascender - descender) * s,
  };
}

/** The one family Zibel bundles (ADR-0013); every other `fontFamily` renders in it. */
export const BUNDLED_FONT = "Source Sans 3";

const faceName = (family: string, style: FontStyle) =>
  style === "Regular" ? family : `${family} ${style}`;

/** A `FONT_MISSING` warning for each text whose family or style is not bundled (ADR-0017, ADR-0028). */
export function fontWarnings(nodes: Node[]): WriteReceipt["warnings"] {
  return nodes.flatMap((n) => {
    if (n.type !== "text") return [];
    const style = n.fontStyle ?? "Regular";
    const drawn = bundledStyle(style);
    return n.fontFamily !== BUNDLED_FONT || drawn !== style
      ? [
          {
            code: "FONT_MISSING",
            nodeId: n.id,
            message: `${faceName(n.fontFamily, style)} is not bundled, so it renders in ${faceName(BUNDLED_FONT, drawn)}; the name is kept.`,
          },
        ]
      : [];
  });
}

/** A `TEXT_OVERFLOW` warning for each Area Type whose content does not all fit (ADR-0022). */
export function overflowWarnings(nodes: Node[]): WriteReceipt["warnings"] {
  return nodes.flatMap((n) => {
    const overflow = n.type === "text" ? layoutText(n).overflow : "";
    return overflow
      ? [
          {
            code: "TEXT_OVERFLOW",
            nodeId: n.id,
            message: `${[...overflow].length} characters do not fit the frame and are not drawn; enlarge the frame or shorten the content.`,
          },
        ]
      : [];
  });
}
