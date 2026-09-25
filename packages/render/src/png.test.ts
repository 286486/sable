import {
  bounds,
  createDocument,
  createNodes,
  imageSource,
  makeMask,
  parseDocument,
} from "@zibel/core";
import { docRect, scopeRect, toSvg } from "@zibel/io";
import { expect, it } from "vitest";
import fixture from "../../../fixtures/documents/inkscape.zibel.json?raw";
import { RED_2x2_PNG } from "../../../fixtures/images.ts";
import { svgToPixels, svgToPng } from "./png.ts";

it("rasterises SVG with resvg-wasm inside workerd", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10" fill="#FF0000"/></svg>`;
  const { png, width, height } = await svgToPng(svg, 2);
  expect([width, height]).toEqual([20, 20]);
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

/** Pixels that are not the white background, as [x, y]. */
async function ink(svg: string) {
  const { pixels, width } = await svgToPixels(svg, 1);
  const out: [number, number][] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) {
      out.push([(i / 4) % width, Math.floor(i / 4 / width)]);
    }
  }
  return out;
}

it("draws text in the bundled font, inside the bounds node_get reports", async () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
  });
  const [text] = createNodes(doc, [
    { type: "text", parentId: defaultLayerId, x: 20, y: 50, content: "Hg", fontSize: 24 },
  ]).nodes;
  const b = text && bounds(doc, text);
  if (!b) throw new Error("setup");
  const drawn = await ink(toSvg(doc));
  // workerd has no system fonts: without the bundled one resvg draws no glyphs at all.
  expect(drawn.length).toBeGreaterThan(20);
  // Pixel [x, y] covers x..x+1; allow a pixel of antialiasing past the box.
  const inside = ([x, y]: [number, number]) =>
    b.x - 1 <= x && x < b.x + b.width + 1 && b.y - 1 <= y && y < b.y + b.height + 1;
  expect(drawn.filter((p) => !inside(p))).toEqual([]);
});

/** The runs of consecutive rows that hold ink: one per drawn line of text. */
const bands = (drawn: [number, number][]) =>
  [...new Set(drawn.map(([, y]) => y))]
    .sort((a, b) => a - b)
    .filter((y, i, ys) => ys[i - 1] !== y - 1).length;

it("draws each line of Point Type and each shown line of Area Type, inside their bounds", async () => {
  const draw = async (input: object) => {
    const { doc, defaultLayerId } = createDocument({
      id: "d",
      name: "Doc",
      artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
    });
    const [text] = createNodes(doc, [{ parentId: defaultLayerId, ...input } as never]).nodes;
    const b = text && bounds(doc, text);
    if (!b) throw new Error("setup");
    const drawn = await ink(toSvg(doc));
    const inside = ([x, y]: [number, number]) =>
      b.x - 1 <= x && x < b.x + b.width + 1 && b.y - 1 <= y && y < b.y + b.height + 1;
    return { lines: bands(drawn), outside: drawn.filter((p) => !inside(p)) };
  };
  expect(await draw({ type: "text", x: 20, y: 25, content: "Hg\nHg\nHg", fontSize: 24 })).toEqual({
    lines: 3,
    outside: [],
  });
  // 60 pt holds four 14.4 pt lines; the fifth overflows and is not drawn.
  expect(
    await draw({
      type: "text",
      kind: "area",
      x: 20,
      y: 10,
      width: 100,
      height: 60,
      content: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    }),
  ).toEqual({ lines: 4, outside: [] });
});

it("keeps runs of spaces, so the drawn width follows the advance sum", async () => {
  const svg = (content: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#FFFFFF"/>` +
    `<text x="0" y="80" font-family="Source Sans 3" font-size="100" style="font-kerning:none" xml:space="preserve">${content}</text></svg>`;
  const right = async (content: string) => Math.max(...(await ink(svg(content))).map(([x]) => x));
  // Two more spaces move the last glyph right by two space advances: 2 × 200 × 100 / 1000 = 40 pt.
  expect((await right("a    b")) - (await right("a  b"))).toBeCloseTo(40, -0.5);
});

it("draws a font Zibel does not bundle in Source Sans 3", async () => {
  const svg = (family: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#FFFFFF"/>` +
    `<text x="0" y="80" font-family="${family}" font-size="60">Hi</text></svg>`;
  const bundled = await ink(svg("Source Sans 3"));
  expect(bundled.length).toBeGreaterThan(0);
  expect(await ink(svg("Helvetica"))).toEqual(bundled);
  expect(await ink(svg("'DejaVu Serif', serif"))).toEqual(bundled);
});

it("leaves an evenodd hole unpainted, and fills it under nonzero", async () => {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 70, height: 70, background: "#FFFFFF" }],
  });
  // Both subpaths wind the same way, so only evenodd makes the inner one a hole.
  const d = "M 10 10 L 60 10 L 60 60 L 10 60 Z M 25 25 L 45 25 L 45 45 L 25 45 Z";
  const [ring] = createNodes(doc, [
    {
      type: "path",
      parentId,
      d,
      fillRule: "evenodd",
      appearance: { fills: [{ color: "#000000" }] },
    },
  ]).nodes;
  const inked = async () => (await ink(toSvg(doc))).map((p) => p.join());
  expect(await inked()).toContain("15,35");
  expect(await inked()).not.toContain("35,35");
  if (ring) doc.nodes.set(ring.id, { ...ring, fillRule: "nonzero" } as typeof ring);
  expect(await inked()).toContain("35,35");
});

it("rounds the pixel size to the nearest pixel and stretches the drawing to it", async () => {
  // Why fit() widens the rect to whole pixels: at 10.2 pt × 2 resvg draws 20 px, not 20.4.
  const size = async (width: number) =>
    (
      await svgToPixels(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10" viewBox="0 0 ${width} 10"/>`,
        2,
      )
    ).width;
  expect(await size(10.2)).toBe(20);
  expect(await size(10.5)).toBe(21);
});

it("reads the root's pt as one pixel per point at scale 1", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="5pt" viewBox="0 0 10 5"/>`;
  expect(await svgToPixels(svg, 1)).toMatchObject({ width: 10, height: 5 });
  expect(await svgToPixels(svg, 2)).toMatchObject({ width: 20, height: 10 });
});

it("draws the fixture Document with known pixels", async () => {
  const file = parseDocument(fixture);
  const images = imageSource(file.images);
  const doc = {
    id: "d",
    version: 1 as const,
    rev: 0,
    ...file,
    nodes: new Map(file.nodes.map((n) => [n.id, n])),
  };
  const hash = async (svg: string) => {
    const { pixels } = await svgToPixels(svg, 2);
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const turned = { nodeIds: [file.nodes.find((n) => n.name === "Turned")?.id ?? ""] };
  // Changed once, by #25: a native <rect rx> or <circle> draws the exact outline where the <path>
  // before it rounded control points to 3 decimals, which moved 3 edge pixels by up to 16/255.
  // Both changed again, by #26: "Turned" draws with its stored 0.866025 where export wrote 0.866, which
  // moved 28 of its antialiased edge pixels at 2x by up to 10/255.
  // The whole Document again, by #27: the fixture gained a Sublayer, a multiply rect, a two-Stroke
  // path with a translucent Stroke and a hidden ellipse. Writing alpha as fill-opacity did not
  // move a pixel. Again by #30: the fixture gained an evenodd ring; by #31, a Clipping Mask; by #33,
  // a multi-line Point Type and an Area Type (writing text as line tspans moved no pixel); by #32,
  // a third Artboard holding three Images, one cropped by a Clipping Mask; by #34, a fourth holding
  // a rounded, randomized, twisted star, a rounded, randomized polygon and a randomized star whose
  // round-number vertices sit on Inkscape's seed grid.
  expect(await hash(toSvg(doc, docRect(doc), { images }))).toBe(
    "e9d487cce974d1a2bb22c1f47988f9f2750e258c43966d792bf97a37807b65db",
  );
  expect(await hash(toSvg(doc, scopeRect(doc, turned), { scope: turned, images }))).toBe(
    "24c1e7ad8db33f59933a1b355c879cb19bfdfd67d70b11427b196aa646ea4b60",
  );
});

it("clips by an inline clipPath the Group refers to before it is defined", async () => {
  const svg = (clip: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#FFFFFF"/>` +
    `<g clip-path="url(#c)"><rect width="100" height="100" fill="#FF0000"/>` +
    `<clipPath id="c" clipPathUnits="userSpaceOnUse">${clip}</clipPath></g></svg>`;
  const drawn = await ink(svg(`<circle cx="50" cy="50" r="10" fill="none"/>`));
  const at = (x: number, y: number) => drawn.some(([px, py]) => px === x && py === y);
  expect(at(50, 50)).toBe(true);
  expect(at(5, 5)).toBe(false);
  expect(drawn.length).toBeLessThan(400);
  // clip-rule, not fill-rule, decides a hole inside a clipPath.
  const ring = `<path d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 40 40 L 60 40 L 60 60 L 40 60 Z"`;
  expect(
    (await ink(svg(`${ring} clip-rule="evenodd"/>`))).some(([x, y]) => x === 50 && y === 50),
  ).toBe(false);
  expect(
    (await ink(svg(`${ring} fill-rule="evenodd"/>`))).some(([x, y]) => x === 50 && y === 50),
  ).toBe(true);
});

it("draws a Clipping Mask's content only inside its Clipping Path", async () => {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 100, height: 100, background: "#FFFFFF" }],
  });
  const [content, clip] = createNodes(doc, [
    {
      type: "rect",
      parentId,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      appearance: { fills: [{ color: "#FF0000" }] },
    },
    { type: "ellipse", parentId, x: 40, y: 40, width: 20, height: 20 },
  ]).nodes;
  if (!content || !clip) throw new Error("setup");
  makeMask(doc, { clipNodeId: clip.id, contentIds: [content.id] });
  const drawn = await ink(toSvg(doc));
  expect(drawn.some(([x, y]) => x === 50 && y === 50)).toBe(true);
  expect(drawn.every(([x, y]) => x >= 39 && x <= 60 && y >= 39 && y <= 60)).toBe(true);
});

it("draws an Image's pixels in its frame and nowhere else", async () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 40, height: 40, background: "#FFFFFF" }],
  });
  const src = "a".repeat(64);
  doc.images.set(src, { mime: "image/png", width: 2, height: 2 });
  createNodes(doc, [
    { type: "image", parentId: defaultLayerId, src, x: 10, y: 10, width: 20, height: 20 },
  ]);
  const drawn = await ink(toSvg(doc, docRect(doc), { images: () => RED_2x2_PNG }));
  expect(drawn.length).toBe(400);
  expect(drawn.filter(([x, y]) => x < 10 || x >= 30 || y < 10 || y >= 30)).toEqual([]);
});
