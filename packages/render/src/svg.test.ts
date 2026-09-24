import {
  createDocument,
  createNodes,
  formatPath,
  type ShapeNode,
  shapeSegments,
} from "@zibel/core";
import { expect, it } from "vitest";
import { fit, scopeRect, svgRect, toSvg } from "./svg.ts";

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

it("writes the root in pt with the Zibel ids, and each Artboard as an Inkscape page", () => {
  const { doc } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [
      { width: 200, height: 100 },
      { name: "Card & back", x: 300, y: 0, width: 50, height: 50, background: "#FFEEDD" },
    ],
  });
  doc.rev = 7;
  const [one, two] = doc.artboards;
  if (!one || !two) throw new Error("setup");
  const svg = toSvg(doc);
  expect(svg).toMatch(
    new RegExp(
      '^<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
        'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:zibel="https://zibel.dev/ns/svg" ' +
        'width="200pt" height="100pt" viewBox="0 0 200 100" zibel:doc="d" zibel:rev="7" zibel:scope="doc">' +
        '<sodipodi:namedview inkscape:document-units="pt">' +
        `<inkscape:page x="0" y="0" width="200" height="100" id="z-${one.id}" inkscape:label="Artboard 1"/>` +
        `<inkscape:page x="300" y="0" width="50" height="50" id="z-${two.id}" inkscape:label="Card &amp; back"/>` +
        "</sodipodi:namedview>" +
        `<rect x="300" y="0" width="50" height="50" fill="#FFEEDD" zibel:artboard="${two.id}" sodipodi:insensitive="true"/><g`,
    ),
  );
  // Inkscape resizes the page at (0,0) to the viewBox: the export's viewBox is its first page.
  expect(svgRect(doc)).toEqual(one.frame);
  expect(svgRect(doc, { artboardId: two.id })).toEqual(two.frame);
  const second = toSvg(doc, svgRect(doc, { artboardId: two.id }), {
    scope: { artboardId: two.id },
  });
  expect(second).toContain(`zibel:scope="artboard:${two.id}"`);
  expect(second.match(/<inkscape:page /g)).toHaveLength(1);
  expect(second).toContain(`<inkscape:page x="300" y="0" width="50" height="50" id="z-${two.id}"`);
  const layer = [...doc.nodes.keys()];
  const nodes = toSvg(doc, { x: 0, y: 0, width: 1, height: 1 }, { scope: { nodeIds: layer } });
  expect(nodes).toContain(`width="1pt" height="1pt" viewBox="0 0 1 1"`);
  expect(nodes).toContain(`zibel:scope="nodes:${layer.join(",")}"`);
  expect(nodes).toContain('<sodipodi:namedview inkscape:document-units="pt"/>');
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  expect(toSvg(doc, rect, { scope: { rect } })).toContain(
    'zibel:scope="rect:1,2,3,4"><sodipodi:namedview inkscape:document-units="pt"/><rect',
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

/** A Layer holding Group A (rect, line) and rect B, on a white Artboard. */
function scene() {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
  });
  const [a, b] = createNodes(doc, [
    {
      type: "group",
      parentId,
      children: [
        {
          type: "rect",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          appearance: { fills: [{ color: "#AA0000" }] },
        },
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 5,
          y2: 5,
          appearance: { strokes: [{ color: "#00AA00" }] },
        },
      ],
    },
    {
      type: "rect",
      parentId,
      x: 50,
      y: 50,
      width: 10,
      height: 10,
      appearance: { fills: [{ color: "#0000AA" }] },
    },
  ]).nodes;
  const [inA, lineInA] = [...doc.nodes.values()].filter((n) => n.parentId === a?.id);
  if (!a || !b || !inA || !lineInA) throw new Error("setup");
  return { doc, a, b, inA, lineInA };
}

it("draws only the listed Nodes and what they contain, inside their ancestors", () => {
  const { doc, a, inA } = scene();
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const group = toSvg(doc, rect, { scope: { nodeIds: [a.id] } });
  expect(group).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><g><g><path[^>]*#AA0000"\/><path[^>]*#00AA00"[^>]*\/><\/g><\/g><\/svg>$/,
  );
  expect(group).not.toContain("#0000AA");
  // A selection export has no Artboard background.
  expect(group).not.toContain("#FFFFFF");
  expect(toSvg(doc, rect, { scope: { nodeIds: [inA.id] } })).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><g><g><path[^>]*#AA0000"\/><\/g><\/g><\/svg>$/,
  );
  a.visible = false;
  expect(toSvg(doc, rect, { scope: { nodeIds: [inA.id] } })).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><\/svg>$/,
  );
});

it("fills the whole rect with background beneath the Artboard backgrounds", () => {
  const { doc, a } = scene();
  const rect = { x: -5, y: -5, width: 300, height: 200 };
  expect(toSvg(doc, rect, { background: "#112233" })).toMatch(
    /<\/sodipodi:namedview><rect x="-5" y="-5" width="300" height="200" fill="#112233"\/><rect x="0" y="0" width="200" height="100" fill="#FFFFFF" zibel:artboard="\w+" sodipodi:insensitive="true"\/><g>/,
  );
  expect(toSvg(doc, rect, { background: "#112233", scope: { nodeIds: [a.id] } })).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><rect[^>]*fill="#112233"\/><g>/,
  );
});

it("labels every drawn Node but Layers with its id and bounds, sized in pixels", () => {
  const { doc, a, b, inA, lineInA } = scene();
  const layer = doc.nodes.get(a.parentId ?? "");
  if (!layer) throw new Error("setup");
  const svg = toSvg(doc, undefined, { overlays: ["ids", "bounds"], scale: 2 });
  for (const n of [a, b, inA, lineInA]) {
    expect(svg).toContain(`>${n.id}</text>`);
  }
  expect(svg).not.toContain(layer.id);
  expect(svg).toContain('font-size="5.5"');
  expect(svg).toContain(
    '<rect x="50" y="50" width="10" height="10" fill="none" stroke="#FF00FF" stroke-width="0.5"/>',
  );
  // Four boxes, none for the Layer; overlays come after the artwork.
  expect(svg.match(/stroke="#FF00FF" stroke-width="0.5"\/>/g)).toHaveLength(4);
  expect(svg.indexOf("#FF00FF")).toBeGreaterThan(svg.indexOf("#0000AA"));
  expect(toSvg(doc)).not.toContain("#FF00FF");
});

it("gives hidden Nodes and Nodes outside the scope no overlay, and outlines Artboards", () => {
  const { doc, a, b, inA } = scene();
  inA.visible = false;
  const svg = toSvg(doc, undefined, {
    scope: { nodeIds: [a.id] },
    overlays: ["ids", "artboards"],
    scale: 4,
  });
  expect(svg).toContain(`>${a.id}</text>`);
  expect(svg).not.toContain(inA.id);
  expect(svg).not.toContain(b.id);
  expect(svg).toContain(
    '<rect x="0" y="0" width="200" height="100" fill="none" stroke="#00AEEF" stroke-width="0.25"/>',
  );
});
