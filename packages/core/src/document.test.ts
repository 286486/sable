import { describe, expect, it } from "vitest";
import { assertParent, createDocument, createNodes, outline } from "./document.ts";
import { ZibelError } from "./errors.ts";

const newDoc = () =>
  createDocument({ id: "d", name: "Doc", artboards: [{ width: 200, height: 100 }] });

const rect = (parentId: string) => ({
  type: "rect" as const,
  parentId,
  x: 10,
  y: 10,
  width: 50,
  height: 30,
});

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

it("creates a Document whose outline starts with one default Layer", () => {
  const { doc, defaultLayerId } = newDoc();
  expect(doc.artboards).toMatchObject([{ frame: { x: 0, y: 0, width: 200, height: 100 } }]);
  expect(outline(doc)).toMatchObject([{ id: defaultLayerId, type: "layer", childCount: 0 }]);
});

it("puts a rect into the Layer and reports its bounds", () => {
  const { doc, defaultLayerId } = newDoc();
  const [node] = createNodes(doc, [rect(defaultLayerId)]).nodes;
  expect(outline(doc)).toMatchObject([
    {
      id: defaultLayerId,
      childCount: 1,
      bounds: { x: 10, y: 10, width: 50, height: 30 },
      children: [{ id: node?.id, type: "rect", bounds: { x: 10, y: 10, width: 50, height: 30 } }],
    },
  ]);
});

it("keeps siblings in creation order", () => {
  const { doc, defaultLayerId } = newDoc();
  const created = createNodes(doc, [
    rect(defaultLayerId),
    rect(defaultLayerId),
    rect(defaultLayerId),
  ]).nodes;
  createNodes(doc, [rect(defaultLayerId)]);
  const ids = outline(doc)[0]?.children?.map((c) => c.id);
  expect(ids?.slice(0, 3)).toEqual(created.map((n) => n.id));
  expect(ids).toHaveLength(4);
});

it("rejects a parent that is not a Layer or Group with INVALID_PARENT", () => {
  const { doc, defaultLayerId } = newDoc();
  const [r] = createNodes(doc, [rect(defaultLayerId)]).nodes;
  expect(codeOf(() => createNodes(doc, [rect(defaultLayerId), rect(r?.id ?? "")]))).toMatchObject({
    code: "INVALID_PARENT",
    path: "nodes[1].parentId",
  });
});

it("rejects an unknown parent with NODE_NOT_FOUND and creates nothing", () => {
  const { doc, defaultLayerId } = newDoc();
  expect(codeOf(() => createNodes(doc, [rect(defaultLayerId), rect("nope")]))).toMatchObject({
    code: "NODE_NOT_FOUND",
    path: "nodes[1].parentId",
  });
  expect(outline(doc)[0]?.childCount).toBe(0);
});

it("rejects an Artboard id as a parent", () => {
  const { doc } = newDoc();
  const artboardId = doc.artboards[0]?.id ?? "";
  expect(codeOf(() => createNodes(doc, [rect(artboardId)]))).toMatchObject({
    code: "INVALID_PARENT",
  });
});

it("stores an Appearance with its defaults filled in", () => {
  const { doc, defaultLayerId } = newDoc();
  const [node] = createNodes(doc, [
    {
      ...rect(defaultLayerId),
      appearance: {
        fills: [{ color: "#ff8800" }],
        strokes: [{ color: "#000000AA", width: 2, cap: "round", dash: [4, 2] }],
      },
    },
  ]).nodes;
  expect(node).toMatchObject({
    appearance: {
      fills: [{ type: "solid", color: "#ff8800" }],
      strokes: [
        { color: "#000000AA", width: 2, cap: "round", join: "miter", miterLimit: 10, dash: [4, 2] },
      ],
    },
  });
});

it("gives a shape without an Appearance Illustrator's default: white Fill, 1 pt black Stroke", () => {
  const { doc, defaultLayerId } = newDoc();
  const [plain, bare] = createNodes(doc, [
    rect(defaultLayerId),
    { ...rect(defaultLayerId), appearance: {} },
  ]).nodes;
  expect(plain).toMatchObject({
    appearance: { fills: [{ color: "#FFFFFF" }], strokes: [{ color: "#000000", width: 1 }] },
  });
  expect(bare).toMatchObject({ appearance: { fills: [], strokes: [] } });
});

it.each([
  ["rgb(255, 136, 0)", /#FF8800/],
  ["red", /#FF0000/],
  [[1, 0.5, 0], /#FF8000/],
  [0.5, /#RRGGBB/],
  ["#F80", /#FF8800/],
])("rejects the color %j with INVALID_COLOR and a conversion hint", (color, hint) => {
  const { doc, defaultLayerId } = newDoc();
  const error = codeOf(() =>
    createNodes(doc, [
      rect(defaultLayerId),
      { ...rect(defaultLayerId), appearance: { strokes: [{ color: "#000000" }, { color }] } },
    ]),
  );
  expect(error).toMatchObject({
    code: "INVALID_COLOR",
    path: "nodes[1].appearance.strokes[1].color",
  });
  expect(error.hint).toMatch(hint);
  expect(outline(doc)[0]?.childCount).toBe(0);
});

it("rejects a bad Artboard background with INVALID_COLOR", () => {
  expect(
    codeOf(() =>
      createDocument({
        id: "d",
        name: "Doc",
        artboards: [{ width: 1, height: 1, background: "white" }],
      }),
    ),
  ).toMatchObject({
    code: "INVALID_COLOR",
    path: "artboards[0].background",
    hint: expect.stringMatching(/#FFFFFF/),
  });
});

it("creates every leaf type and nested Layers, with bounds from their geometry", () => {
  const { doc, defaultLayerId: layer } = newDoc();
  const { nodes } = createNodes(doc, [
    { type: "layer", name: "Top" },
    { type: "layer", parentId: layer, name: "Sub" },
    { type: "ellipse", parentId: layer, x: 0, y: 0, width: 20, height: 10 },
    { type: "line", parentId: layer, x1: 5, y1: 50, x2: 25, y2: 40 },
    { type: "polygon", parentId: layer, cx: 50, cy: 50, radius: 10, sides: 6 },
    { type: "star", parentId: layer, cx: 0, cy: 0, outerRadius: 10, innerRadius: 3, points: 4 },
    { type: "path", parentId: layer, d: "M 0 0 L 10.00004 0 L 10 10 Z" },
  ]);
  expect(nodes.map((n) => [n.type, n.parentId])).toEqual([
    ["layer", null],
    ["layer", layer],
    ["ellipse", layer],
    ["line", layer],
    ["polygon", layer],
    ["star", layer],
    ["path", layer],
  ]);
  expect(nodes[6]).toMatchObject({ d: "M 0 0 L 10 0 L 10 10 Z" });
  const [top, main] = outline(doc);
  expect(top).toMatchObject({ name: "Layer 1", childCount: 6 });
  expect(main).toMatchObject({ name: "Top", childCount: 0, bounds: null });
  const box = Object.fromEntries((top?.children ?? []).map((c) => [c.type, c.bounds]));
  expect(box.ellipse).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  expect(box.line).toEqual({ x: 5, y: 40, width: 20, height: 10 });
  expect(box.star).toEqual({ x: -10, y: -10, width: 20, height: 20 });
  expect(box.path).toEqual({ x: 0, y: 0, width: 10, height: 10 });
});

it("returns INVALID_PATH at the item's d", () => {
  const { doc, defaultLayerId } = newDoc();
  expect(
    codeOf(() => createNodes(doc, [{ type: "path", parentId: defaultLayerId, d: "M 0 0 h 10" }])),
  ).toMatchObject({ code: "INVALID_PATH", path: "nodes[0].d", hint: expect.any(String) });
});

it("creates a Group with inline children, depth first, with a keyMap for every clientKey", () => {
  const { doc, defaultLayerId } = newDoc();
  const { nodes, keyMap } = createNodes(doc, [
    {
      type: "group",
      parentId: defaultLayerId,
      clientKey: "g",
      children: [
        { ...rect(defaultLayerId), clientKey: "a" },
        {
          type: "group",
          clientKey: "inner",
          children: [{ type: "line", clientKey: "b", x1: 0, y1: 0, x2: 100, y2: 80 }],
        },
      ],
    },
    { ...rect(defaultLayerId), clientKey: "c" },
  ]);
  const [g, a, inner, b, c] = nodes;
  expect(nodes.map((n) => n.type)).toEqual(["group", "rect", "group", "line", "rect"]);
  expect([a?.parentId, inner?.parentId, b?.parentId, c?.parentId]).toEqual([
    g?.id,
    g?.id,
    inner?.id,
    defaultLayerId,
  ]);
  expect(keyMap).toEqual({ g: g?.id, a: a?.id, inner: inner?.id, b: b?.id, c: c?.id });
  expect(outline(doc, 3)[0]?.children?.[0]).toMatchObject({
    type: "group",
    childCount: 2,
    bounds: { x: 0, y: 0, width: 100, height: 80 },
  });
});

describe("tree rules (ADR-0005)", () => {
  const setup = () => {
    const { doc, defaultLayerId: layer } = newDoc();
    const [group, inner, leaf] = createNodes(doc, [
      {
        type: "group",
        parentId: layer,
        children: [{ type: "group", children: [rect(layer)] }],
      },
    ]).nodes;
    const [sub] = createNodes(doc, [{ type: "layer", parentId: layer }]).nodes;
    const id = (n: { id: string } | undefined) => n?.id ?? "";
    return { doc, layer, group: id(group), inner: id(inner), leaf: id(leaf), sub: id(sub) };
  };
  const t = setup();
  const artboard = t.doc.artboards[0]?.id ?? "";

  it.each([
    // [child type, parent, allowed]
    ["layer", null, true],
    ["layer", t.layer, true],
    ["layer", t.sub, true],
    ["layer", t.group, false],
    ["layer", t.leaf, false],
    ["group", null, false],
    ["group", t.layer, true],
    ["group", t.group, true],
    ["group", t.leaf, false],
    ["rect", null, false],
    ["rect", t.layer, true],
    ["rect", t.inner, true],
    ["rect", t.leaf, false],
    ["rect", artboard, false],
  ] as const)("a %s under %s: %s", (type, parentId, allowed) => {
    const check = () => assertParent(t.doc, { type }, parentId, "p");
    if (allowed) expect(check).not.toThrow();
    else
      expect(codeOf(check)).toMatchObject({
        code: "INVALID_PARENT",
        path: "p",
        hint: expect.any(String),
      });
  });

  it("rejects an unknown parent with NODE_NOT_FOUND", () => {
    expect(codeOf(() => assertParent(t.doc, { type: "rect" }, "nope", "p"))).toMatchObject({
      code: "NODE_NOT_FOUND",
    });
  });

  it("rejects a cycle: a Group under itself or its own descendant", () => {
    for (const parentId of [t.group, t.inner]) {
      expect(
        codeOf(() => assertParent(t.doc, { type: "group", id: t.group }, parentId, "p")),
      ).toMatchObject({ code: "INVALID_PARENT", message: expect.stringMatching(/cycle/) });
    }
    expect(() => assertParent(t.doc, { type: "group", id: t.inner }, t.layer, "p")).not.toThrow();
  });

  it("rejects a Layer under a Group through node_create too, creating nothing", () => {
    const before = t.doc.nodes.size;
    expect(
      codeOf(() => createNodes(t.doc, [rect(t.layer), { type: "layer", parentId: t.group }])),
    ).toMatchObject({ code: "INVALID_PARENT", path: "nodes[1].parentId" });
    expect(t.doc.nodes.size).toBe(before);
  });
});
