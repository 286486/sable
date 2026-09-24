import type { Node, Rect, WriteReceipt } from "./schema.ts";
import { SOURCE_SANS_3 } from "./source-sans-3.ts";

const advances: Record<number, number> = SOURCE_SANS_3.advances;

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
  leading?: number | undefined;
}

/** One laid-out line: its characters and where its baseline starts. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}

/** A string's advance sum in font units. */
function advance(text: string) {
  // ponytail: advance sum, no shaping or kerning; HarfBuzz (F-TEXT-09, M1) replaces this with
  // shaped glyph positions.
  let width = 0;
  for (const ch of text) width += advances[ch.codePointAt(0) as number] ?? SOURCE_SANS_3.notdef;
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
  if (text.kind !== "area") {
    const lines = content.split("\n").map((t, i) => ({ text: t, x, y: y + i * leading }));
    return { lines, overflow: "" };
  }
  const { unitsPerEm, ascender, descender } = SOURCE_SANS_3;
  const { width = 0, height = 0 } = text;
  // Trailing spaces and the return hang past the frame's edge.
  const fits = (line: string) => (advance(line.trimEnd()) * fontSize) / unitsPerEm <= width;
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
  const last = lines.at(-1) as TextLine;
  return {
    x: text.x,
    y: text.y - ascender * s,
    width: Math.max(...lines.map((l) => advance(l.text))) * s,
    height: last.y - text.y + (ascender - descender) * s,
  };
}

/** The one font Zibel bundles (ADR-0013); every other `fontFamily` renders in it. */
export const BUNDLED_FONT = "Source Sans 3";

/** A `FONT_MISSING` warning for each text whose font is not bundled (ADR-0017). */
export function fontWarnings(nodes: Pick<Node, "id" | "type">[]): WriteReceipt["warnings"] {
  return nodes.flatMap((n) =>
    "fontFamily" in n && n.fontFamily !== BUNDLED_FONT
      ? [
          {
            code: "FONT_MISSING",
            nodeId: n.id,
            message: `${n.fontFamily} is not bundled, so it renders in ${BUNDLED_FONT}; the name is kept.`,
          },
        ]
      : [],
  );
}
