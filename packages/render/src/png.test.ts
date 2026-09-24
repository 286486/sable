import { bounds, createDocument, createNodes, parseDocument } from "@zibel/core";
import { expect, it } from "vitest";
import fixture from "../../../fixtures/documents/inkscape.zibel.json?raw";
import { svgToPixels, svgToPng } from "./png.ts";
import { docRect, scopeRect, toSvg } from "./svg.ts";

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
  expect(await hash(toSvg(doc, docRect(doc)))).toBe(
    "dc0372d1d7a380ea3e80f7d2ad145af58c78f0f4411ba20eea4878ea158974ab",
  );
  expect(await hash(toSvg(doc, scopeRect(doc, turned), { scope: turned }))).toBe(
    "db787e8c66eef5455ce2bb127ad6b5cb9d4d78eb50af924407cc9d235d35f1ab",
  );
});
