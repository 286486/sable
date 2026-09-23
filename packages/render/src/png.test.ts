import { bounds, createDocument, createNodes } from "@zibel/core";
import { expect, it } from "vitest";
import { svgToPixels, svgToPng } from "./png.ts";
import { toSvg } from "./svg.ts";

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

it("keeps runs of spaces, so the drawn width follows the advance sum", async () => {
  const svg = (content: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#FFFFFF"/>` +
    `<text x="0" y="80" font-family="Source Sans 3" font-size="100" style="font-kerning:none" xml:space="preserve">${content}</text></svg>`;
  const right = async (content: string) => Math.max(...(await ink(svg(content))).map(([x]) => x));
  // Two more spaces move the last glyph right by two space advances: 2 × 200 × 100 / 1000 = 40 pt.
  expect((await right("a    b")) - (await right("a  b"))).toBeCloseTo(40, -0.5);
});
