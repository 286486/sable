import { expect, it } from "vitest";
import { SOURCE_SANS_3 } from "./source-sans-3.ts";
import { fontWarnings, layoutText, textBox } from "./text.ts";

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

// Area Type as Inkscape 1.2.2 lays it out in the bundled font, measured headless (ADR-0022): the
// first baseline sits (leading − fontSize) / 2 + fontSize · 1000 / 1326 below the frame's top.
const area = (content: string, frame: { width: number; height: number }, leading?: number) =>
  layoutText({ kind: "area", x: 150, y: 20, ...frame, content, fontSize: 12, leading });

it("breaks Point Type at hard returns only, one leading apart, 120% of fontSize when Auto", () => {
  const auto = layoutText({ x: 10, y: 50, content: "a b\n\nc", fontSize: 12 });
  expect(auto.lines.map((l) => [l.text, l.x, l.y])).toEqual([
    ["a b", 10, 50],
    ["", 10, 64.4],
    ["c", 10, 78.8],
  ]);
  expect(auto.overflow).toBe("");
  const set = layoutText({ x: 10, y: 50, content: "a\nb", fontSize: 12, leading: 15 });
  expect(set.lines.map((l) => l.y)).toEqual([50, 65]);
});

it("measures multi-line Point Type from the first ascender to the last descender, as wide as its widest line", () => {
  const box = textBox({ x: 10, y: 50, content: "i\nHi", fontSize: 12, leading: 15 });
  expect(box.y).toBeCloseTo(50 - at12(1000));
  expect(box.width).toBeCloseTo(at12(652 + 246));
  expect(box.height).toBeCloseTo(15 + at12(1000 + 326));
});

it("wraps Area Type at spaces where Inkscape does, trailing spaces and returns kept on the line", () => {
  const { lines, overflow } = area(
    "The quick brown fox jumps over the lazy dog again and again.\nNew para",
    { width: 100, height: 80 },
  );
  expect(lines.map((l) => l.text)).toEqual([
    "The quick brown ",
    "fox jumps over the ",
    "lazy dog again and ",
    "again.\n",
    "New para",
  ]);
  expect(lines.every((l) => l.x === 150)).toBe(true);
  expect(lines[0]?.y).toBeCloseTo(30.249774, 5);
  expect(lines[4]?.y).toBeCloseTo(30.249774 + 4 * 14.4, 5);
  expect(overflow).toBe("");
});

it("keeps empty paragraphs, and no line for a final return", () => {
  const { lines } = area("a\n\nb\n", { width: 100, height: 100 }, 15);
  expect(lines.map((l) => l.text)).toEqual(["a\n", "\n", "b\n"]);
  expect(lines.map((l) => l.y - 20)).toEqual(
    [10.549774, 25.549774, 40.549774].map((y) => expect.closeTo(y, 5)),
  );
});

it("shows a line while 90% of its leading fits the frame, and holds the rest as overflow", () => {
  expect(area("one\ntwo\nthree\nfour", { width: 100, height: 40 })).toMatchObject({
    lines: [{ text: "one\n" }, { text: "two\n" }],
    overflow: "three\nfour",
  });
  expect(area("one\ntwo\nthree\nfour", { width: 100, height: 3 * 14.4 - 1.44 }).lines).toHaveLength(
    3,
  );
  expect(area("one\ntwo\nthree\nfour", { width: 100, height: 3 * 14.4 - 1.45 }).lines).toHaveLength(
    2,
  );
});

it("overflows a word wider than the frame and everything after it, as Inkscape does", () => {
  const text = "Supercalifragilistic word  two   spaces";
  expect(area(text, { width: 50, height: 100 })).toEqual({ lines: [], overflow: text });
});

it("measures Area Type as its frame", () => {
  const frame = { x: 150, y: 20, width: 100, height: 40 };
  expect(textBox({ kind: "area", ...frame, content: "one", fontSize: 12 })).toEqual(frame);
});
