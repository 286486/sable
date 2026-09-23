import { describe, expect, it } from "vitest";
import {
  assertParent,
  bounds,
  createDocument,
  createNodes,
  nodeView,
  outline,
  queryNodes,
  touches,
  visibleBounds,
} from "./document.ts";
import { ZibelError } from "./errors.ts";
import { compose } from "./matrix.ts";
import { NodeQuery } from "./schema.ts";

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

describe("nodeView", () => {
  const setup = () => {
    const { doc, defaultLayerId } = newDoc();
    const [group, round, path] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        name: "G",
        children: [
          {
            type: "rect",
            x: 0,
            y: 0,
            width: 40,
            height: 20,
            radius: 5,
            appearance: {
              strokes: [
                { color: "#000000", width: 2 },
                { color: "#FF0000", width: 6 },
              ],
            },
          },
          { type: "path", d: "M 0 0 L 10 0 L 10 10" },
        ],
      },
    ]).nodes;
    if (!group || !round || !path) throw new Error("setup");
    return { doc, group, round, path };
  };

  it("full: parameters, derived d, Appearance, bounds and worldTransform", () => {
    const { doc, round } = setup();
    const view = nodeView(doc, round, "full");
    expect(view).toMatchObject({
      id: round.id,
      type: "rect",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      radius: 5,
      appearance: { fills: [], strokes: [{ width: 2 }, { width: 6 }] },
      geometricBounds: { x: 0, y: 0, width: 40, height: 20 },
      visibleBounds: { x: -3, y: -3, width: 46, height: 26 },
      worldTransform: [1, 0, 0, 1, 0, 0],
      childCount: 0,
    });
    expect(view.d).toMatch(/^M 5 0 L 35 0 C/);
    expect(view.closed).toBe(true);
  });

  it("full: a Path returns its stored d", () => {
    const { doc, path } = setup();
    expect(nodeView(doc, path, "full")).toMatchObject({ d: "M 0 0 L 10 0 L 10 10", closed: false });
  });

  it("concise: identity, structure and geometric bounds only", () => {
    const { doc, group, round } = setup();
    const view = nodeView(doc, round, "concise");
    expect(view).toEqual({
      id: round.id,
      type: "rect",
      name: "",
      parentId: group.id,
      visible: true,
      locked: false,
      childCount: 0,
      geometricBounds: { x: 0, y: 0, width: 40, height: 20 },
    });
    expect(nodeView(doc, group, "concise")).toMatchObject({ childCount: 2 });
  });

  it("worldTransform composes the ancestors' transforms", () => {
    const { doc, group, round } = setup();
    group.transform = [2, 0, 0, 2, 10, 20];
    round.transform = [1, 0, 0, 1, 5, 5];
    expect(nodeView(doc, round, "full").worldTransform).toEqual([2, 0, 0, 2, 20, 30]);
  });

  it("a container's visibleBounds covers its children's Strokes", () => {
    const { doc, group } = setup();
    expect(nodeView(doc, group, "full")).toMatchObject({
      geometricBounds: { x: 0, y: 0, width: 40, height: 20 },
      visibleBounds: { x: -3, y: -3, width: 46, height: 26 },
    });
  });
});

it("rejects an inline Layer in a Group's children with INVALID_PARENT, creating nothing", () => {
  const { doc, defaultLayerId } = newDoc();
  const before = doc.nodes.size;
  expect(
    codeOf(() =>
      createNodes(doc, [
        {
          type: "group",
          parentId: defaultLayerId,
          children: [rect(defaultLayerId), { type: "layer" }],
        },
      ]),
    ),
  ).toMatchObject({
    code: "INVALID_PARENT",
    path: "nodes[0].children[1].type",
    hint: expect.any(String),
  });
  expect(doc.nodes.size).toBe(before);
});

it("gives each default Appearance its own arrays", () => {
  const { doc, defaultLayerId } = newDoc();
  const [a, b] = createNodes(doc, [rect(defaultLayerId), rect(defaultLayerId)]).nodes;
  if (!a || !b || !("appearance" in a) || !("appearance" in b)) throw new Error("setup");
  expect(a.appearance.strokes[0]?.dash).not.toBe(b.appearance.strokes[0]?.dash);
});

describe("bounds honour transform", () => {
  it("rotates a rect's bounds about its center", () => {
    const { doc, defaultLayerId } = newDoc();
    const [node] = createNodes(doc, [rect(defaultLayerId)]).nodes;
    if (!node) throw new Error("setup");
    node.transform = compose({ rotate: 90 }, { x: 35, y: 25 });
    const b = bounds(doc, node);
    expect(b?.x).toBeCloseTo(20, 9);
    expect(b?.y).toBeCloseTo(0, 9);
    expect(b?.width).toBeCloseTo(30, 9);
    expect(b?.height).toBeCloseTo(50, 9);
  });

  it("finds the true extent of a rotated ellipse, not its control points", () => {
    const { doc, defaultLayerId } = newDoc();
    const [e] = createNodes(doc, [
      { type: "ellipse", parentId: defaultLayerId, x: 0, y: 0, width: 100, height: 50 },
    ]).nodes;
    if (!e) throw new Error("setup");
    e.transform = compose({ rotate: 45 }, { x: 50, y: 25 });
    const c = Math.SQRT1_2;
    expect(bounds(doc, e)?.width).toBeCloseTo(
      2 * Math.sqrt(50 ** 2 * c ** 2 + 25 ** 2 * c ** 2),
      1,
    );
  });

  it("applies the ancestors' transforms and scales the Stroke growth", () => {
    const { doc, defaultLayerId } = newDoc();
    const [g, r] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        children: [
          { ...rect(defaultLayerId), appearance: { strokes: [{ color: "#000000", width: 2 }] } },
        ],
      },
    ]).nodes;
    if (!g || !r) throw new Error("setup");
    g.transform = [2, 0, 0, 2, 10, 20];
    expect(bounds(doc, r)).toEqual({ x: 30, y: 40, width: 100, height: 60 });
    expect(visibleBounds(doc, r)).toEqual({ x: 28, y: 38, width: 104, height: 64 });
    expect(outline(doc)[0]?.bounds).toEqual({ x: 30, y: 40, width: 100, height: 60 });
  });
});

it("stores tags and meta given at creation", () => {
  const { doc, defaultLayerId } = newDoc();
  const [r] = createNodes(doc, [{ ...rect(defaultLayerId), tags: ["bar"], meta: { q: 3 } }]).nodes;
  expect(r).toMatchObject({ tags: ["bar"], meta: { q: 3 } });
});

describe("the 2000-Node cap per node_create", () => {
  it("counts inline children and hints how to split", () => {
    const { doc, defaultLayerId } = newDoc();
    const flat = Array.from({ length: 2001 }, () => rect(defaultLayerId));
    const nested = [
      {
        type: "group" as const,
        parentId: defaultLayerId,
        children: Array.from({ length: 2000 }, () => ({
          ...rect(defaultLayerId),
          parentId: undefined,
        })),
      },
    ];
    for (const inputs of [flat, nested]) {
      expect(codeOf(() => createNodes(doc, inputs))).toMatchObject({
        code: "LIMIT_EXCEEDED",
        path: "nodes",
        hint: expect.stringMatching(/2000.*[Ss]plit|[Ss]plit.*2000/),
      });
    }
    expect(doc.nodes.size).toBe(1);
    expect(createNodes(doc, flat.slice(1)).nodes).toHaveLength(2000);
  });
});

it("creates the valid items with partial and reports the invalid one", () => {
  const { doc, defaultLayerId } = newDoc();
  const { nodes, failed, keyMap } = createNodes(
    doc,
    [
      { ...rect(defaultLayerId), clientKey: "a" },
      {
        type: "group",
        parentId: defaultLayerId,
        clientKey: "g",
        children: [rect(defaultLayerId), { type: "layer" }],
      },
    ],
    { partial: true },
  );
  expect(nodes).toHaveLength(1);
  expect(Object.keys(keyMap)).toEqual(["a"]);
  expect(failed).toMatchObject([
    { index: 1, code: "INVALID_PARENT", path: "nodes[1].children[1].type" },
  ]);
  expect(outline(doc)[0]?.childCount).toBe(1);
});

describe("text", () => {
  // Advances from the TTF at 12 pt: H 652, i 246, space 200; ascender 1000, descender -326.
  const text = (parentId: string, content = "Hi") =>
    ({ type: "text", parentId, x: 10, y: 50, content }) as const;

  it("stores Point Type in Source Sans 3 at 12 pt with a black Fill and no Stroke", () => {
    const { doc, defaultLayerId } = newDoc();
    const [node] = createNodes(doc, [text(defaultLayerId)]).nodes;
    expect(node).toMatchObject({
      type: "text",
      kind: "point",
      x: 10,
      y: 50,
      content: "Hi",
      fontFamily: "Source Sans 3",
      fontSize: 12,
      appearance: { fills: [{ color: "#000000" }], strokes: [] },
    });
  });

  it("is bounded by its advances and the font's ascender and descender, and has no d", () => {
    const { doc, defaultLayerId } = newDoc();
    const [hi, longer] = createNodes(doc, [
      text(defaultLayerId),
      text(defaultLayerId, "Hi Hi"),
    ]).nodes;
    if (!hi || !longer) throw new Error("setup");
    const b = bounds(doc, hi);
    expect(b?.x).toBeCloseTo(10);
    expect(b?.y).toBeCloseTo(38);
    expect(b?.width).toBeCloseTo(10.776);
    expect(b?.height).toBeCloseTo(15.912);
    expect((bounds(doc, longer)?.width ?? 0) - (b?.width ?? 0)).toBeCloseTo(13.176);
    const full = nodeView(doc, hi, "full");
    expect(full).not.toHaveProperty("d");
    expect(full).not.toHaveProperty("closed");
  });

  it("maps its box through its transform", () => {
    const { doc, defaultLayerId } = newDoc();
    const [node] = createNodes(doc, [text(defaultLayerId)]).nodes;
    if (!node) throw new Error("setup");
    doc.nodes.set(node.id, { ...node, transform: [0, 1, -1, 0, 0, 0] });
    const b = bounds(doc, doc.nodes.get(node.id) ?? node);
    // (10, 38)-(20.776, 53.912) turned 90° clockwise about the origin.
    expect(b?.x).toBeCloseTo(-53.912);
    expect(b?.y).toBeCloseTo(10);
    expect(b?.width).toBeCloseTo(15.912);
    expect(b?.height).toBeCloseTo(10.776);
  });

  it("is created inline in a Group", () => {
    const { doc, defaultLayerId } = newDoc();
    const [group, inner] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        children: [{ type: "text", x: 10, y: 50, content: "Hi" }],
      },
    ]).nodes;
    expect(inner).toMatchObject({ type: "text", parentId: group?.id });
  });

  it.each(["", "a\nb", "a\rb", "a\tb", "a\u2028b"])("rejects content %j", (content) => {
    const { doc, defaultLayerId } = newDoc();
    expect(() => createNodes(doc, [text(defaultLayerId, content)])).toThrow();
    expect(doc.nodes.size).toBe(1);
  });
});

it("touches two rects that share only an edge, not two apart", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  expect(touches(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(true);
  expect(touches(a, { x: 10.5, y: 0, width: 5, height: 5 })).toBe(false);
});

describe("queryNodes", () => {
  /** Layer L: rect "Sun" (tagged sky, warm) at 0,0 10x10; Group G with rect "Moon" (sky) at 50,50
   * 10x10 and a hidden, locked text; an empty Group E. Layer M: nothing. */
  const fixture = () => {
    const { doc, defaultLayerId: L } = newDoc();
    const r = (name: string, x: number, tags: string[]) => ({
      type: "rect" as const,
      name,
      x,
      y: x,
      width: 10,
      height: 10,
      tags,
      clientKey: name,
    });
    const { keyMap } = createNodes(doc, [
      { ...r("Sun", 0, ["sky", "warm"]), parentId: L },
      {
        type: "group",
        parentId: L,
        name: "G",
        clientKey: "G",
        children: [
          r("Moon", 50, ["sky"]),
          { type: "text", x: 50, y: 100, content: "Hi", clientKey: "T" },
        ],
      },
      { type: "group", parentId: L, name: "E", clientKey: "E", children: [] },
      { type: "layer", name: "M", clientKey: "M" },
    ]);
    const ids = { L, ...keyMap } as Record<string, string>;
    const t = doc.nodes.get(ids.T as string);
    if (t) Object.assign(t, { visible: false, locked: true });
    return { doc, ids };
  };
  const names = (q: NodeQuery) => {
    const { doc } = fixture();
    return queryNodes(doc, q)
      .nodes.map((n) => n.name || n.type)
      .sort();
  };

  it("returns every Node without filters, hidden and locked ones included", () => {
    expect(names({})).toEqual(["E", "G", "Layer 1", "M", "Moon", "Sun", "text"]);
  });
  it("filters by types", () => {
    expect(names({ types: ["rect", "text"] })).toEqual(["Moon", "Sun", "text"]);
  });
  it("filters by nameRegex against the stored name", () => {
    expect(names({ nameRegex: "^(S|M)" })).toEqual(["M", "Moon", "Sun"]);
  });
  it("filters by tags, each Node carrying every listed tag", () => {
    expect(names({ tags: ["sky"] })).toEqual(["Moon", "Sun"]);
    expect(names({ tags: ["sky", "warm"] })).toEqual(["Sun"]);
  });
  it("filters by direct parent only; an unknown parent matches nothing", () => {
    const { doc, ids } = fixture();
    const of = (parentId: string) => queryNodes(doc, { parentId }).nodes.map((n) => n.name);
    expect(of(ids.L as string).sort()).toEqual(["E", "G", "Sun"]);
    expect(of("01NOPE")).toEqual([]);
  });
  it("filters by withinRect, edges included; an empty Group never matches", () => {
    expect(names({ withinRect: { x: 0, y: 0, width: 10, height: 10 } })).toEqual(["Sun"]);
    expect(names({ withinRect: { x: -1, y: -1, width: 1000, height: 1000 } })).toEqual([
      "G",
      "Layer 1",
      "Moon",
      "Sun",
      "text",
    ]);
  });
  it("filters by intersectsRect, touching counts", () => {
    expect(names({ intersectsRect: { x: 10, y: 10, width: 5, height: 5 } })).toEqual([
      "Layer 1",
      "Sun",
    ]);
  });
  it("ANDs the filters", () => {
    expect(names({ types: ["rect"], tags: ["sky"], nameRegex: "o" })).toEqual(["Moon"]);
  });

  it("pages through the matches in id order with nextCursor", () => {
    const { doc, defaultLayerId } = newDoc();
    const made = createNodes(
      doc,
      Array.from({ length: 5 }, () => rect(defaultLayerId)),
    ).nodes;
    const sorted = made.map((n) => n.id).sort();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const res = queryNodes(doc, { types: ["rect"], limit: 2, cursor });
      seen.push(...res.nodes.map((n) => n.id));
      cursor = res.nextCursor ?? undefined;
      expect(res.nextCursor === null).toBe(page === 2);
    }
    expect(seen).toEqual(sorted);
  });
  it("ends with nextCursor null when the last page is exactly full", () => {
    const { doc, defaultLayerId } = newDoc();
    createNodes(
      doc,
      Array.from({ length: 4 }, () => rect(defaultLayerId)),
    );
    const first = queryNodes(doc, { types: ["rect"], limit: 2 });
    const second = queryNodes(doc, { types: ["rect"], limit: 2, cursor: first.nextCursor ?? "" });
    expect(second.nodes).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
  it("returns concise views, 100 by default", () => {
    const { doc, defaultLayerId } = newDoc();
    createNodes(
      doc,
      Array.from({ length: 101 }, () => rect(defaultLayerId)),
    );
    const res = queryNodes(doc, { types: ["rect"] });
    expect(res.nodes).toHaveLength(100);
    expect(Object.keys(res.nodes[0] ?? {}).sort()).toEqual([
      "childCount",
      "geometricBounds",
      "id",
      "locked",
      "name",
      "parentId",
      "type",
      "visible",
    ]);
  });
  it("rejects a nameRegex that does not compile or runs past 200 characters", () => {
    expect(NodeQuery.safeParse({ nameRegex: "(" }).success).toBe(false);
    expect(NodeQuery.safeParse({ nameRegex: "a".repeat(201) }).success).toBe(false);
    expect(NodeQuery.safeParse({ nameRegex: "a".repeat(200) }).success).toBe(true);
  });
});
