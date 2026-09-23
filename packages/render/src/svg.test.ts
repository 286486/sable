import {
  createDocument,
  createNodes,
  formatPath,
  type ShapeNode,
  shapeSegments,
} from "@zibel/core";
import { expect, it } from "vitest";
import { fit, scopeRect, toSvg } from "./svg.ts";

const newDoc = () =>
  createDocument({ id: "d", name: "Doc", artboards: [{ width: 200, height: 100 }] });

it("serialises the Artboards with a rect's Fill below its Stroke", () => {
  const { doc, defaultLayerId } = newDoc();
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
    '<g><path d="M 10 10 L 60 10 L 60 40 L 10 40 Z" fill="#FF0000"/>' +
      '<path d="M 10 10 L 60 10 L 60 40 L 10 40 Z" fill="none" stroke="#000000" stroke-width="2" stroke-miterlimit="10"/></g>',
  );
});

it("serialises every node type with the same d that node_get returns", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const { nodes } = createNodes(doc, [
    {
      type: "group",
      parentId,
      children: [
        { type: "rect", x: 0, y: 0, width: 10, height: 10, radius: 2 },
        { type: "group", children: [{ type: "line", x1: 0, y1: 0, x2: 5, y2: 5 }] },
      ],
    },
    { type: "ellipse", parentId, x: 0, y: 0, width: 20, height: 10 },
    { type: "polygon", parentId, cx: 50, cy: 50, radius: 10, sides: 5 },
    { type: "star", parentId, cx: 80, cy: 50, outerRadius: 10, innerRadius: 4, points: 5 },
    { type: "path", parentId, d: "M 0 0 Q 10 20 20 0 Z" },
    { type: "layer" },
  ]);
  const svg = toSvg(doc);
  const leaves = nodes.filter((n): n is ShapeNode => "appearance" in n);
  expect(leaves).toHaveLength(6);
  for (const n of leaves) expect(svg).toContain(`d="${formatPath(shapeSegments(n))}"`);
  // Layer 1 > Group > [rect, Group > line]; the second top-level Layer is empty.
  expect(svg).toMatch(/<g><g><path[^>]*\/><path[^>]*\/><g><path/);
  expect(svg).toMatch(/<g><\/g><\/svg>$/);
});

it("paints stacked Fills and Strokes bottom to top, with Stroke attributes only when set", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    {
      type: "line",
      parentId,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
      appearance: {
        fills: [{ color: "#111111" }, { color: "#222222" }],
        strokes: [
          { color: "#333333", width: 4, cap: "round", join: "bevel", dash: [4, 2] },
          { color: "#44444480" },
        ],
      },
    },
  ]);
  const svg = toSvg(doc);
  const colors = [...svg.matchAll(/(?:fill|stroke)="(#\w+)"/g)].map((m) => m[1]);
  expect(colors).toEqual(["#111111", "#222222", "#333333", "#44444480"]);
  expect(svg).toContain(
    'stroke="#333333" stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="4 2"/>',
  );
  expect(svg).toContain('stroke="#44444480" stroke-width="1" stroke-miterlimit="10"/>');
});

it("emits nothing for an empty Appearance or a hidden Node, and wraps a translucent one", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [bare, hidden, faded] = createNodes(doc, [
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1, appearance: {} },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
  ]).nodes;
  if (!bare || !hidden || !faded) throw new Error("setup");
  hidden.visible = false;
  faded.opacity = 0.5;
  expect(toSvg(doc)).toMatch(/<g><g opacity="0.5"><path[^>]*\/><path[^>]*\/><\/g><\/g><\/svg>$/);
});

it("wraps a transformed leaf in one <g> carrying its matrix and opacity", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [turned, both] = createNodes(doc, [
    { type: "rect", parentId, x: 10, y: 10, width: 50, height: 30 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
  ]).nodes;
  if (!turned || !both) throw new Error("setup");
  turned.transform = [0, 1, -1, 0, 60, -10];
  both.transform = [0.1234567, 0, 0, 1, 0, 0];
  both.opacity = 0.5;
  const svg = toSvg(doc);
  expect(svg).toMatch(/<g transform="matrix\(0 1 -1 0 60 -10\)"><path[^>]*\/><path[^>]*\/><\/g>/);
  expect(svg).toContain('<g opacity="0.5" transform="matrix(0.123 0 0 1 0 0)"><path');
});

it("writes Point Type as one <text> per Fill, then per Stroke, in the bundled font family", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    { type: "text", parentId, x: 10, y: 50, content: "Hi" },
    {
      type: "text",
      parentId,
      x: 0,
      y: 20,
      content: 'a<b&"c"',
      fontSize: 24,
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#0000FF", width: 2 }] },
    },
  ]);
  const svg = toSvg(doc);
  expect(svg).toContain(
    '<text x="10" y="50" font-family="Source Sans 3" font-size="12" style="font-kerning:none" xml:space="preserve" fill="#000000">Hi</text>',
  );
  expect(svg).toContain(
    '<text x="0" y="20" font-family="Source Sans 3" font-size="24" style="font-kerning:none" xml:space="preserve" fill="#FF0000">a&lt;b&amp;&quot;c&quot;</text>' +
      '<text x="0" y="20" font-family="Source Sans 3" font-size="24" style="font-kerning:none" xml:space="preserve" fill="none" stroke="#0000FF" stroke-width="2" stroke-miterlimit="10">a&lt;b&amp;&quot;c&quot;</text>',
  );
});

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { data?: unknown }).data;
  }
  throw new Error("did not throw");
};

it("resolves each Render Scope to the rect the image covers", () => {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [
      { width: 200, height: 100 },
      { x: 300, y: 0, width: 50, height: 50 },
    ],
  });
  const [rect, group] = createNodes(doc, [
    {
      type: "rect",
      parentId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      appearance: { strokes: [{ color: "#000000", width: 4 }] },
    },
    { type: "group", parentId, children: [] },
  ]).nodes;
  if (!rect || !group) throw new Error("setup");
  const second = doc.artboards[1];
  if (!second) throw new Error("setup");
  expect(scopeRect(doc)).toEqual({ x: 0, y: 0, width: 350, height: 100 });
  expect(scopeRect(doc, { artboardId: second.id })).toEqual(second.frame);
  expect(scopeRect(doc, { rect: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
    x: 1,
    y: 2,
    width: 3,
    height: 4,
  });
  expect(scopeRect(doc, { nodeIds: [rect.id, group.id] })).toEqual({
    x: 8,
    y: 8,
    width: 54,
    height: 34,
  });
  expect(errorOf(() => scopeRect(doc, { artboardId: "nope" }))).toMatchObject({
    code: "ARTBOARD_NOT_FOUND",
    path: "scope.artboardId",
  });
  expect(errorOf(() => scopeRect(doc, { nodeIds: [rect.id, "nope"] }))).toMatchObject({
    code: "NODE_NOT_FOUND",
    path: "scope.nodeIds[1]",
  });
  expect(errorOf(() => scopeRect(doc, { nodeIds: [group.id] }))).toMatchObject({
    code: "NOTHING_TO_RENDER",
  });
});

it("fits a rect to whole pixels, lowering the scale to maxSize and refusing more than 4096 px", () => {
  const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height });
  expect(fit(rect(200, 100), 2)).toEqual({
    rect: rect(200, 100),
    scale: 2,
    pixelSize: { width: 400, height: 200 },
  });
  expect(fit(rect(2000, 100), 1, 1600)).toEqual({
    rect: rect(2000, 100),
    scale: 0.8,
    pixelSize: { width: 1600, height: 80 },
  });
  // Widened to whole pixels, since resvg stretches the drawing to its rounded size.
  expect(fit(rect(10.2, 10), 2)).toEqual({
    rect: rect(10.5, 10),
    scale: 2,
    pixelSize: { width: 21, height: 20 },
  });
  expect(errorOf(() => fit(rect(2000, 100), 4, 8000))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    path: "maxSize",
    hint: expect.stringContaining("4096"),
  });
  expect(errorOf(() => fit(rect(2000, 100), 4))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    path: "scale",
    hint: expect.stringContaining("scale <= 2.04"),
  });
});
