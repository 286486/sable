import {
  createDocument,
  createNodes,
  formatPath,
  makeMask,
  type ShapeNode,
  shapeSegments,
} from "@zibel/core";
import { expect, it } from "vitest";
import { scopeRect, svgRect, toSvg } from "./write.ts";

const newDoc = () =>
  createDocument({ id: "d", name: "Doc", artboards: [{ width: 200, height: 100 }] });

it("writes a leaf with one Fill and one Stroke as one element", () => {
  const { doc, defaultLayerId } = newDoc();
  const [rect] = createNodes(doc, [
    {
      type: "rect",
      parentId: defaultLayerId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#000000", width: 2 }] },
    },
  ]).nodes;
  expect(toSvg(doc)).toContain(
    `<rect x="10" y="10" width="50" height="30" id="z-${rect?.id}" fill="#FF0000" stroke="#000000" stroke-width="2" stroke-miterlimit="10"/></g>`,
  );
});

it("writes rect, ellipse and line as their own elements, and other shapes as the d node_get returns", () => {
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
    { type: "ellipse", parentId, x: 40, y: 0, width: 10, height: 10 },
    { type: "rect", parentId, x: 0, y: 0, width: 4, height: 10, radius: 5 },
    { type: "polygon", parentId, cx: 50, cy: 50, radius: 10, sides: 5 },
    { type: "star", parentId, cx: 80, cy: 50, outerRadius: 10, innerRadius: 4, points: 5 },
    { type: "path", parentId, d: "M 0 0 Q 10 20 20 0 Z" },
    { type: "layer" },
  ]);
  const svg = toSvg(doc);
  const paths = nodes.filter(
    (n): n is ShapeNode => n.type === "polygon" || n.type === "star" || n.type === "path",
  );
  expect(paths).toHaveLength(3);
  for (const n of paths) expect(svg).toContain(`d="${formatPath(shapeSegments(n))}"`);
  expect(svg).toContain('<rect x="0" y="0" width="10" height="10" rx="2" ry="2" id=');
  expect(svg).toContain(
    '<path sodipodi:type="star" sodipodi:sides="5" sodipodi:cx="50" sodipodi:cy="50" sodipodi:r1="10" sodipodi:r2="8.09" ' +
      'sodipodi:arg1="-1.5707963267948966" sodipodi:arg2="-0.9424777960769379" inkscape:flatsided="true" ' +
      'inkscape:rounded="0" inkscape:randomized="0" d="M 50 40 L 59.511 46.91 L 55.878 58.09',
  );
  expect(svg).toContain(
    '<path sodipodi:type="star" sodipodi:sides="5" sodipodi:cx="80" sodipodi:cy="50" sodipodi:r1="10" sodipodi:r2="4" ' +
      'sodipodi:arg1="-1.5707963267948966" sodipodi:arg2="-0.9424777960769379" inkscape:flatsided="false" ' +
      'inkscape:rounded="0" inkscape:randomized="0" d="M 80 40 L 82.351 46.764',
  );
  expect(svg).toContain('<line x1="0" y1="0" x2="5" y2="5" id=');
  expect(svg).toContain('<ellipse cx="10" cy="5" rx="10" ry="5" id=');
  expect(svg).toContain('<circle cx="45" cy="5" r="5" id=');
  // The radius is clamped to half the shorter side.
  expect(svg).toContain('<rect x="0" y="0" width="4" height="10" rx="2" ry="2" id=');
  // Layer 1 > Group > [rect, Group > line]; the second top-level Layer is empty.
  expect(svg).toMatch(/<g [^>]*inkscape:groupmode="layer"><g [^>]*><rect[^>]*\/><g [^>]*><line/);
  expect(svg).toMatch(/<g [^>]*inkscape:groupmode="layer"><\/g><\/svg>$/);
});

it("paints an Appearance stack bottom to top in a <g zibel:stack>, with Stroke attributes only when set", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [line] = createNodes(doc, [
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
  ]).nodes;
  const svg = toSvg(doc);
  expect(svg).toContain(
    `<g id="z-${line?.id}" zibel:stack="true"><line x1="0" y1="0" x2="10" y2="0" fill="#111111"/>`,
  );
  const colors = [...svg.matchAll(/(?:fill|stroke)="(#\w+)"/g)].map((m) => m[1]);
  expect(colors).toEqual(["#111111", "#222222", "#333333", "#444444"]);
  expect(svg).toContain(
    'stroke="#333333" stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="4 2"/>',
  );
  expect(svg).toContain(
    'stroke="#444444" stroke-opacity="0.502" stroke-width="1" stroke-miterlimit="10"/>',
  );
});

it("writes a colour's alpha as fill-opacity and stroke-opacity, which Inkscape 1.2 reads", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    {
      type: "rect",
      parentId,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      appearance: { fills: [{ color: "#FF000080" }], strokes: [{ color: "#00000060" }] },
    },
  ]);
  const svg = toSvg(doc, undefined, { background: "#11223340" });
  expect(svg).toContain(
    'fill="#FF0000" fill-opacity="0.502" stroke="#000000" stroke-opacity="0.376"',
  );
  expect(svg).toContain('fill="#112233" fill-opacity="0.251" zibel:background="true"');
  expect(svg).not.toMatch(/="#\w{8}"/);
});

it("writes an empty Appearance as fill none, and a hidden or translucent Node's style", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [bare, hidden, faded] = createNodes(doc, [
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1, appearance: {} },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
  ]).nodes;
  if (!bare || !hidden || !faded) throw new Error("setup");
  hidden.visible = false;
  faded.opacity = 0.5;
  faded.blendMode = "multiply";
  const svg = toSvg(doc);
  expect(svg).toContain(`id="z-${bare.id}" fill="none"/>`);
  expect(svg).toContain(
    `id="z-${hidden.id}" fill="#FFFFFF" stroke="#000000" stroke-width="1" stroke-miterlimit="10" style="display:none"/>`,
  );
  expect(svg).toContain(`style="opacity:0.5;mix-blend-mode:multiply"/></g></svg>`);
});

it("writes every Node's id, name, lock, tags and meta, and Layers as Inkscape layers", () => {
  const { doc, defaultLayerId } = newDoc();
  const [rect, layer] = createNodes(doc, [
    {
      type: "rect",
      parentId: defaultLayerId,
      name: 'Card "A"\nback',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      tags: ["badge"],
      meta: { note: 'say "hi"' },
      appearance: { fills: [{ color: "#FF0000" }] },
    },
    { type: "layer", name: "Guides" },
  ]).nodes;
  if (!rect || !layer) throw new Error("setup");
  layer.visible = false;
  layer.locked = true;
  rect.locked = true;
  const svg = toSvg(doc);
  expect(svg).toContain(
    `<g id="z-${defaultLayerId}" inkscape:label="Layer 1" inkscape:groupmode="layer"><rect x="0" y="0" width="1" height="1" ` +
      `id="z-${rect.id}" inkscape:label="Card &quot;A&quot;&#10;back" sodipodi:insensitive="true" ` +
      `zibel:tags="[&quot;badge&quot;]" zibel:meta="{&quot;note&quot;:&quot;say \\&quot;hi\\&quot;&quot;}" fill="#FF0000"/></g>`,
  );
  expect(svg).toContain(
    `<g id="z-${layer.id}" inkscape:label="Guides" sodipodi:insensitive="true" inkscape:groupmode="layer" style="display:none"></g></svg>`,
  );
});

it("writes a leaf's matrix on its own element, and a stack's on its <g>", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [turned, both] = createNodes(doc, [
    { type: "rect", parentId, x: 10, y: 10, width: 50, height: 30 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
  ]).nodes;
  if (!turned || !both) throw new Error("setup");
  turned.transform = [0, 1, -1, 0, 60, -10];
  both.transform = [0.1234567, 0, 0, 1, 0, 0];
  both.opacity = 0.5;
  if (both.type !== "rect") throw new Error("setup");
  both.appearance.fills.push({ type: "solid", color: "#00FF00" });
  const svg = toSvg(doc);
  // At the 6 decimals a matrix is stored in, so importing the file gives the same matrix back.
  expect(svg).toContain(`id="z-${turned.id}" transform="matrix(0 1 -1 0 60 -10)" fill="#FFFFFF"`);
  expect(svg).toContain(
    `<g id="z-${both.id}" transform="matrix(0.123457 0 0 1 0 0)" zibel:stack="true" style="opacity:0.5"><rect`,
  );
});

it("writes Point Type as one <text> in its font family, a line tspan per line", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    { type: "text", parentId, x: 10, y: 50, content: "Hi\n\nHo" },
    {
      type: "text",
      parentId,
      x: 0,
      y: 20,
      content: 'a<b&"c"',
      fontSize: 24,
      leading: 30,
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#0000FF", width: 2 }] },
    },
  ]);
  const svg = toSvg(doc);
  expect(svg).toMatch(
    /<text x="10" y="50" font-family="Source Sans 3" font-size="12" id="z-\w+" fill="#000000" style="font-kerning:none;line-height:1.2" xml:space="preserve"><tspan sodipodi:role="line" x="10" y="50">Hi<\/tspan><tspan sodipodi:role="line" x="10" y="64.4"><\/tspan><tspan sodipodi:role="line" x="10" y="78.8">Ho<\/tspan><\/text>/,
  );
  expect(svg).toMatch(
    /<text x="0" y="20" font-family="Source Sans 3" font-size="24" id="z-\w+" fill="#FF0000" stroke="#0000FF" stroke-width="2" stroke-miterlimit="10" style="font-kerning:none;line-height:30px" xml:space="preserve"><tspan sodipodi:role="line" x="0" y="20">a&lt;b&amp;&quot;c&quot;<\/tspan><\/text>/,
  );
});

const areaText = (content: string, extra: object = {}) => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [node] = createNodes(doc, [
    {
      type: "text",
      kind: "area",
      parentId,
      x: 150,
      y: 20,
      width: 100,
      height: 80,
      content,
      ...extra,
    },
  ]).nodes;
  return { svg: toSvg(doc), id: node?.id };
};

it("writes Area Type as shape-inside a <defs> rect, with a positioned tspan per shown line", () => {
  const { svg, id } = areaText(
    "The quick brown fox jumps over the lazy dog again and again.\nNew para",
  );
  const lines = [
    "The quick brown ",
    "fox jumps over the ",
    "lazy dog again and ",
    "again.&#10;",
    "New para",
  ]
    .map((t, i) => `<tspan x="150" y="${[30.25, 44.65, 59.05, 73.45, 87.85][i]}">${t}</tspan>`)
    .join("");
  expect(svg).toContain(
    `<defs><rect id="area-z-${id}" x="150" y="20" width="100" height="80"/></defs><text font-family="Source Sans 3" font-size="12" id="z-${id}" fill="#000000" style="shape-inside:url(#area-z-${id});white-space:pre;font-kerning:none;line-height:1.2" xml:space="preserve">${lines}</text>`,
  );
  expect(svg).not.toContain("visibility:hidden");
});

it("writes Area Type's overflow in a hidden tspan, so every character stays in the file", () => {
  const { svg } = areaText("one\ntwo\nthree", { height: 20 });
  expect(svg).toMatch(
    /y="30.25">one&#10;<\/tspan><tspan style="visibility:hidden">two&#10;three<\/tspan><\/text>/,
  );
});

it("writes one <defs> before an Area Type's stack, for every paint to flow in", () => {
  const { svg, id } = areaText("Hi", {
    appearance: { fills: [{ color: "#FF0000" }, { color: "#00FF00" }] },
  });
  expect(svg.match(/<defs>/g)).toHaveLength(1);
  expect(svg).toContain(`</defs><g id="z-${id}" zibel:stack="true">`);
  expect(svg.match(new RegExp(`shape-inside:url\\(#area-z-${id}\\)`, "g"))).toHaveLength(2);
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
        'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:zibel="https://zibel.dev/ns/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'width="200pt" height="100pt" viewBox="0 0 200 100" zibel:doc="d" zibel:rev="7" zibel:scope="doc" sodipodi:docname="Doc.svg">' +
        '<sodipodi:namedview inkscape:document-units="pt">' +
        `<inkscape:page x="0" y="0" width="200" height="100" id="z-${one.id}" inkscape:label="Artboard 1"/>` +
        `<inkscape:page x="300" y="0" width="50" height="50" id="z-${two.id}" inkscape:label="Card &amp; back"/>` +
        "</sodipodi:namedview>" +
        `<rect x="300" y="0" width="50" height="50" fill="#FFEEDD" zibel:artboard="${two.id}" sodipodi:insensitive="true"/><g`,
    ),
  );
  // Inkscape resizes the page at (0,0) to the viewBox: the export's viewBox is that page, else
  // the first.
  expect(svgRect(doc)).toEqual(one.frame);
  const moved = { ...doc, artboards: [{ ...one, frame: { ...one.frame, x: 100, y: 50 } }, two] };
  expect(svgRect(moved)).toEqual(moved.artboards[0]?.frame);
  const swapped = {
    ...moved,
    artboards: [moved.artboards[0], { ...two, frame: { ...two.frame, x: 0 } }],
  };
  expect(svgRect(swapped as typeof doc)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
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
    'zibel:scope="rect:1,2,3,4" sodipodi:docname="Doc.svg"><sodipodi:namedview inkscape:document-units="pt"/><rect',
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

/** A Layer holding Group A (rect, line) and rect B, on a white Artboard. */
function scene() {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
  });
  // Inline children follow their Group: [Group A, its rect, its line, rect B].
  const [a, inA, lineInA, b] = createNodes(doc, [
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
  if (!a || !b || !inA || !lineInA) throw new Error("setup");
  return { doc, a, b, inA, lineInA };
}

it("draws only the listed Nodes and what they contain, inside their ancestors", () => {
  const { doc, a, inA } = scene();
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const group = toSvg(doc, rect, { scope: { nodeIds: [a.id] } });
  expect(group).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><g [^>]*><g [^>]*><rect[^>]*#AA0000"\/><line[^>]*#00AA00"[^>]*\/><\/g><\/g><\/svg>$/,
  );
  expect(group).not.toContain("#0000AA");
  // A selection export has no Artboard background.
  expect(group).not.toContain("#FFFFFF");
  expect(toSvg(doc, rect, { scope: { nodeIds: [inA.id] } })).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><g [^>]*><g [^>]*><rect[^>]*#AA0000"\/><\/g><\/g><\/svg>$/,
  );
  // A hidden ancestor is written with its listed child, which stays undrawn.
  a.visible = false;
  expect(toSvg(doc, rect, { scope: { nodeIds: [inA.id] } })).toMatch(
    new RegExp(
      `<g id="z-${a.id}" style="display:none"><rect[^>]*id="z-${inA.id}" fill="#AA0000"/></g></g></svg>$`,
    ),
  );
});

it("fills the whole rect with background beneath the Artboard backgrounds", () => {
  const { doc, a } = scene();
  const rect = { x: -5, y: -5, width: 300, height: 200 };
  expect(toSvg(doc, rect, { background: "#112233" })).toMatch(
    /<\/sodipodi:namedview><rect x="-5" y="-5" width="300" height="200" fill="#112233" zibel:background="true"\/><rect x="0" y="0" width="200" height="100" fill="#FFFFFF" zibel:artboard="\w+" sodipodi:insensitive="true"\/><g /,
  );
  expect(toSvg(doc, rect, { background: "#112233", scope: { nodeIds: [a.id] } })).toMatch(
    /<svg[^>]*><sodipodi:namedview[^>]*\/><rect[^>]*fill="#112233" zibel:background="true"\/><g /,
  );
});

it("writes fill-rule evenodd on a Path and on each paint of its stack, and nothing for nonzero", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const d = "M 0 0 L 30 0 L 30 30 L 0 30 Z M 10 10 L 20 10 L 20 20 L 10 20 Z";
  const [ring, , plain] = createNodes(doc, [
    { type: "path", parentId, d, fillRule: "evenodd" },
    {
      type: "path",
      parentId,
      d,
      fillRule: "evenodd",
      appearance: { fills: [{ color: "#111111" }, { color: "#222222" }] },
    },
    { type: "path", parentId, d },
  ]).nodes;
  const svg = toSvg(doc);
  expect(svg).toContain(`<path d="${d}" fill-rule="evenodd" id="z-${ring?.id}"`);
  expect(svg).toContain(
    `zibel:stack="true"><path d="${d}" fill-rule="evenodd" fill="#111111"/><path d="${d}" fill-rule="evenodd" fill="#222222"/></g>`,
  );
  expect(svg).toContain(`<path d="${d}" id="z-${plain?.id}"`);
});

/** A Group of a rect under a Clipping Path, the ellipse, and a rect above it. */
function clipped() {
  const { doc, defaultLayerId } = newDoc();
  const [below, clip, above] = createNodes(doc, [
    { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 10, height: 10 },
    { type: "ellipse", parentId: defaultLayerId, x: 2, y: 2, width: 4, height: 4 },
    { type: "rect", parentId: defaultLayerId, x: 5, y: 5, width: 10, height: 10 },
  ]).nodes as [ShapeNode, ShapeNode, ShapeNode];
  const { group } = makeMask(doc, { clipNodeId: clip.id, contentIds: [below.id, above.id] });
  return { doc, group, below, clip, above };
}

it("writes a Clipping Mask as <g clip-path> with its Clipping Path in an inline <clipPath>, in place", () => {
  const { doc, group, below, clip, above } = clipped();
  const svg = toSvg(doc);
  expect(svg).toContain(
    `<g id="z-${group.id}" clip-path="url(#clip-z-${group.id})"><rect x="0" y="0" width="10" height="10" id="z-${below.id}"`,
  );
  expect(svg).toContain(
    `<clipPath id="clip-z-${group.id}" clipPathUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" id="z-${clip.id}" fill="none"/></clipPath><rect x="5" y="5" width="10" height="10" id="z-${above.id}"`,
  );
});

it("writes an evenodd Clipping Path's clip-rule, and one element for a painted one", () => {
  const { doc, defaultLayerId } = newDoc();
  const [content, clip] = createNodes(doc, [
    { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 10, height: 10 },
    { type: "path", parentId: defaultLayerId, d: "M 0 0 L 9 0 L 9 9 Z", fillRule: "evenodd" },
  ]).nodes as [ShapeNode, ShapeNode];
  makeMask(doc, { clipNodeId: clip.id, contentIds: [content.id] });
  const painted = {
    fills: [
      { type: "solid" as const, color: "#FF0000" },
      { type: "solid" as const, color: "#00FF00" },
    ],
    strokes: [],
  };
  doc.nodes.set(clip.id, { ...(doc.nodes.get(clip.id) as ShapeNode), appearance: painted });
  const svg = toSvg(doc);
  expect(svg).toContain(
    `fill-rule="evenodd" id="z-${clip.id}" fill="#FF0000" clip-rule="evenodd"/></clipPath>`,
  );
  expect(svg).not.toContain("zibel:stack");
});

it("keeps the clip around a listed Node inside a Clipping Mask, and draws only that Node", () => {
  const { doc, group, below, clip } = clipped();
  let drawn: string[] = [];
  const svg = toSvg(doc, undefined, {
    scope: { nodeIds: [below.id] },
    trailer: (nodes) => {
      drawn = nodes.map((n) => n.id);
      return "";
    },
  });
  expect(svg).toContain(`clip-path="url(#clip-z-${group.id})"`);
  expect(svg).toContain(`id="z-${clip.id}"`);
  expect(drawn).toEqual([below.id]);
});

it("writes an Image as <image xlink:href>, which Inkscape 1.2 draws, with its file inlined", () => {
  const { doc, defaultLayerId } = newDoc();
  const src = "a".repeat(64);
  doc.images.set(src, { mime: "image/png", width: 2, height: 2 });
  const [image] = createNodes(doc, [
    { type: "image", parentId: defaultLayerId, src, x: 10, y: 20, width: 30, height: 40 },
  ]).nodes;
  const url = "data:image/png;base64,AAAA";
  const svg = toSvg(doc, undefined, { images: (id) => (id === src ? url : undefined) });
  expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  expect(svg).toContain(
    `<image x="10" y="20" width="30" height="40" preserveAspectRatio="none" xlink:href="${url}" id="z-${image?.id}"/>`,
  );
  expect(() => toSvg(doc)).toThrow(
    expect.objectContaining({ data: expect.objectContaining({ code: "INVALID_IMAGE" }) }),
  );
});
