import { expect, it } from "vitest";
import { SOURCE_SANS_3 } from "./source-sans-3.ts";
import { fontWarnings, textBox } from "./text.ts";

// Read straight from SourceSans3-Regular.ttf, not from the generated table: unitsPerEm 1000,
// hhea ascender 1000 and descender -326; advances H 652, i 246, space 200, .notdef 653.
const at12 = (units: number) => (units * 12) / 1000;

it("measures a line by its advance widths, from the ascender to the descender", () => {
  const box = textBox({ x: 10, y: 50, content: "Hi", fontSize: 12 });
  expect(box.x).toBe(10);
  expect(box.y).toBeCloseTo(50 - at12(1000));
  expect(box.width).toBeCloseTo(at12(652 + 246));
  expect(box.height).toBeCloseTo(at12(1000 + 326));
});

it("grows by each added character's advance, and counts .notdef for one the font lacks", () => {
  const width = (content: string) => textBox({ x: 0, y: 0, content, fontSize: 12 }).width;
  expect(width("Hi Hi") - width("Hi")).toBeCloseTo(at12(200 + 652 + 246));
  expect(width("中")).toBeCloseTo(at12(653));
});

it("carries the font's vertical metrics", () => {
  const { unitsPerEm, ascender, descender } = SOURCE_SANS_3;
  expect([unitsPerEm, ascender, descender]).toEqual([1000, 1000, -326]);
});

it("warns once for each text in a font Zibel does not bundle", () => {
  const text = (id: string, fontFamily: string) =>
    ({ id, type: "text", fontFamily }) as Parameters<typeof fontWarnings>[0][number];
  expect(
    fontWarnings([text("a", "Source Sans 3"), text("b", "Helvetica"), { id: "c", type: "rect" }]),
  ).toEqual([
    {
      code: "FONT_MISSING",
      nodeId: "b",
      message: "Helvetica is not bundled, so it renders in Source Sans 3; the name is kept.",
    },
  ]);
});
