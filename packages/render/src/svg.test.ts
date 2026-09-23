import { createDocument, createNodes } from "@zibel/core";
import { expect, it } from "vitest";
import { toSvg } from "./svg.ts";

it("serialises the first Artboard with its Layers and rects", () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  createNodes(doc, [
    {
      type: "rect",
      parentId: defaultLayerId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#000000", width: 2 }] },
    },
  ]);
  const svg = toSvg(doc);
  expect(svg).toContain('viewBox="0 0 200 100"');
  expect(svg).toContain(
    '<path d="M 10 10 L 60 10 L 60 40 L 10 40 Z" fill="#FF0000" stroke="#000000" stroke-width="2"/>',
  );
});
