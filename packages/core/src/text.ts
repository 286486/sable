import type { Rect } from "./schema.ts";
import { SOURCE_SANS_3 } from "./source-sans-3.ts";

const advances: Record<number, number> = SOURCE_SANS_3.advances;

/**
 * Point Type's box (ADR-0013): from the baseline origin `x, y`, as wide as the advances and as
 * tall as the font's ascender to descender.
 */
export function textBox(text: { x: number; y: number; content: string; fontSize: number }): Rect {
  const { unitsPerEm, ascender, descender, notdef } = SOURCE_SANS_3;
  const s = text.fontSize / unitsPerEm;
  // ponytail: advance sum, no shaping or kerning; HarfBuzz (F-TEXT-09, M1) replaces this with
  // shaped glyph positions.
  let width = 0;
  for (const ch of text.content) width += advances[ch.codePointAt(0) as number] ?? notdef;
  return {
    x: text.x,
    y: text.y - ascender * s,
    width: width * s,
    height: (ascender - descender) * s,
  };
}
