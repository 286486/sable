import { describe, expect, it } from "vitest";
import { bounds, createDocument, createNodes, outline } from "./document.ts";
import { deleteNodes, transformNodes, updateNodes } from "./edit.ts";
import { ZibelError } from "./errors.ts";
import type { Node, ShapeNode } from "./schema.ts";

const newDoc = () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  const rect = (x: number, y: number, extra: object = {}) =>
    ({ type: "rect", parentId: defaultLayerId, x, y, width: 50, height: 30, ...extra }) as const;
  return { doc, defaultLayerId, rect };
};

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

const near = (r: ReturnType<typeof bounds>) =>
  r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));

const shape = (doc: { nodes: Map<string, Node> }, id: string) => doc.nodes.get(id) as ShapeNode;

describe("transformNodes", () => {
  it("rotates a rect about its center, keeping its parameters", () => {
    const { doc, rect } = newDoc();
    const [r] = createNodes(doc, [rect(10, 10)]).nodes;
    if (!r) throw new Error("setup");
    const { nodes } = transformNodes(doc, { nodeIds: [r.id], rotate: 90 });
    expect(nodes.map((n) => n.id)).toEqual([r.id]);
    const after = shape(doc, r.id);
    expect(after).toMatchObject({ x: 10, y: 10, width: 50, height: 30 });
    expect(after.transform).toEqual([0, 1, -1, 0, 60, -10]);
    expect(near(bounds(doc, after))).toEqual({ x: 20, y: 0, width: 30, height: 50 });
  });

  it("pushes a Group's transform down to its leaves (ADR-0007)", () => {
    const { doc, defaultLayerId } = newDoc();
    const [g, a, inner, b] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        children: [
          { type: "rect", x: 0, y: 0, width: 10, height: 10 },
          { type: "group", children: [{ type: "line", x1: 0, y1: 0, x2: 5, y2: 5 }] },
        ],
      },
    ]).nodes;
    if (!g || !a || !inner || !b) throw new Error("setup");
    const { nodes } = transformNodes(doc, { nodeIds: [g.id], translate: { x: 100 } });
    expect(nodes.map((n) => n.id)).toEqual([a.id, b.id]);
    expect(doc.nodes.get(g.id)?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(doc.nodes.get(inner.id)?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(shape(doc, a.id).transform).toEqual([1, 0, 0, 1, 100, 0]);
    expect(bounds(doc, doc.nodes.get(g.id) as Node)).toEqual({
      x: 100,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it("turns targets about one shared pivot, or each about its own with each", () => {
    const { doc, rect } = newDoc();
    const [a, b] = createNodes(doc, [rect(0, 0), rect(100, 0)]).nodes;
    if (!a || !b) throw new Error("setup");
    transformNodes(doc, { nodeIds: [a.id, b.id], rotate: 180 });
    expect(near(bounds(doc, shape(doc, a.id)))?.x).toBe(100);
    expect(near(bounds(doc, shape(doc, b.id)))?.x).toBe(0);
    transformNodes(doc, { nodeIds: [a.id, b.id], rotate: 180, each: true });
    expect(near(bounds(doc, shape(doc, a.id)))?.x).toBe(100);
    expect(near(bounds(doc, shape(doc, b.id)))?.x).toBe(0);
  });

  it("uses a named reference point or coordinates as the pivot", () => {
    const { doc, rect } = newDoc();
    const [a] = createNodes(doc, [rect(10, 10)]).nodes;
    if (!a) throw new Error("setup");
    transformNodes(doc, { nodeIds: [a.id], scale: 2, pivot: "topLeft" });
    expect(near(bounds(doc, shape(doc, a.id)))).toEqual({ x: 10, y: 10, width: 100, height: 60 });
    transformNodes(doc, { nodeIds: [a.id], scale: 0.5, pivot: "bottomRight" });
    expect(near(bounds(doc, shape(doc, a.id)))).toEqual({ x: 60, y: 40, width: 50, height: 30 });
    transformNodes(doc, { nodeIds: [a.id], rotate: 90, pivot: { x: 0, y: 0 } });
    expect(near(bounds(doc, shape(doc, a.id)))).toEqual({ x: -70, y: 60, width: 30, height: 50 });
  });

  it("keeps the stored Stroke width unless scaleStrokes is false", () => {
    const { doc, rect } = newDoc();
    const strokes = [{ color: "#000000", width: 2, dash: [4, 2] }];
    const [a, b] = createNodes(doc, [
      rect(0, 0, { appearance: { strokes } }),
      rect(0, 50, { appearance: { strokes } }),
    ]).nodes;
    if (!a || !b) throw new Error("setup");
    transformNodes(doc, { nodeIds: [a.id], scale: 2 });
    transformNodes(doc, { nodeIds: [b.id], scale: 2, scaleStrokes: false });
    expect(shape(doc, a.id).appearance.strokes[0]).toMatchObject({ width: 2, dash: [4, 2] });
    expect(shape(doc, b.id).appearance.strokes[0]).toMatchObject({ width: 1, dash: [2, 1] });
  });

  it("scales each axis on its own and skews", () => {
    const { doc, rect } = newDoc();
    const [a] = createNodes(doc, [rect(0, 0)]).nodes;
    if (!a) throw new Error("setup");
    transformNodes(doc, { nodeIds: [a.id], scale: { x: 2, y: 1 }, pivot: "topLeft" });
    expect(shape(doc, a.id).transform).toEqual([2, 0, 0, 1, 0, 0]);
    transformNodes(doc, { nodeIds: [a.id], skew: { x: 45 }, pivot: "topLeft" });
    expect(shape(doc, a.id).transform).toEqual([2, 0, 1, 1, 0, 0]);
  });

  it("moves a listed descendant of another target once and warns", () => {
    const { doc, defaultLayerId } = newDoc();
    const [g, r] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        children: [{ type: "rect", x: 0, y: 0, width: 10, height: 10 }],
      },
    ]).nodes;
    if (!g || !r) throw new Error("setup");
    const { nodes, warnings } = transformNodes(doc, {
      nodeIds: [g.id, r.id],
      translate: { x: 5 },
    });
    expect(nodes.map((n) => n.id)).toEqual([r.id]);
    expect(shape(doc, r.id).transform).toEqual([1, 0, 0, 1, 5, 0]);
    expect(warnings).toEqual([
      { code: "NESTED_TARGET", nodeId: r.id, message: expect.any(String) },
    ]);
  });

  it("leaves an empty Group alone", () => {
    const { doc, defaultLayerId } = newDoc();
    const [g] = createNodes(doc, [{ type: "group", parentId: defaultLayerId }]).nodes;
    if (!g) throw new Error("setup");
    expect(transformNodes(doc, { nodeIds: [g.id], rotate: 10 }).nodes).toEqual([]);
  });

  it("returns NODE_NOT_FOUND for an unknown id and changes nothing", () => {
    const { doc, rect } = newDoc();
    const [a] = createNodes(doc, [rect(0, 0)]).nodes;
    if (!a) throw new Error("setup");
    expect(
      errorOf(() => transformNodes(doc, { nodeIds: [a.id, "nope"], translate: { x: 1 } })),
    ).toMatchObject({ code: "NODE_NOT_FOUND", path: "nodeIds[1]", hint: expect.any(String) });
    expect(shape(doc, a.id).transform).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("updateNodes", () => {
  const setup = () => {
    const { doc, defaultLayerId, rect } = newDoc();
    const [r, p] = createNodes(doc, [
      rect(10, 10, {
        appearance: {
          fills: [{ color: "#00FF00" }],
          strokes: [{ color: "#000000" }, { color: "#FFFFFF", width: 3 }],
        },
      }),
      { type: "path", parentId: defaultLayerId, d: "M 0 0 L 5 5" },
    ]).nodes;
    if (!r || !p) throw new Error("setup");
    return { doc, defaultLayerId, r, p };
  };

  it("merges common properties, recursing into meta and deleting with null (RFC 7396)", () => {
    const { doc, r } = setup();
    updateNodes(doc, [
      {
        nodeId: r.id,
        patch: {
          name: "Hero",
          visible: false,
          opacity: 0.5,
          blendMode: "multiply",
          tags: ["a"],
          meta: { a: 1, b: 2 },
        },
      },
    ]);
    const { nodes } = updateNodes(doc, [{ nodeId: r.id, patch: { meta: { b: null, c: 3 } } }]);
    expect(nodes.map((n) => n.id)).toEqual([r.id]);
    expect(doc.nodes.get(r.id)).toMatchObject({
      name: "Hero",
      visible: false,
      opacity: 0.5,
      blendMode: "multiply",
      tags: ["a"],
      meta: { a: 1, c: 3 },
    });
  });

  it("changes Live Shape parameters, which changes the derived outline", () => {
    const { doc, r } = setup();
    updateNodes(doc, [{ nodeId: r.id, patch: { radius: 8, width: 60 } }]);
    expect(shape(doc, r.id)).toMatchObject({ radius: 8, width: 60, height: 30 });
    expect(bounds(doc, shape(doc, r.id))).toEqual({ x: 10, y: 10, width: 60, height: 30 });
  });

  it("replaces a whole fills or strokes list and keeps the other", () => {
    const { doc, r } = setup();
    updateNodes(doc, [{ nodeId: r.id, patch: { appearance: { fills: [{ color: "#FF0000" }] } } }]);
    expect(shape(doc, r.id).appearance.fills).toEqual([{ type: "solid", color: "#FF0000" }]);
    expect(shape(doc, r.id).appearance.strokes).toHaveLength(2);
    updateNodes(doc, [
      { nodeId: r.id, patch: { appearance: { strokes: [{ color: "#000000" }] } } },
    ]);
    expect(shape(doc, r.id).appearance.strokes).toEqual([
      { color: "#000000", width: 1, cap: "butt", join: "miter", miterLimit: 10, dash: [] },
    ]);
  });

  it("normalises a Path's new d", () => {
    const { doc, p } = setup();
    updateNodes(doc, [{ nodeId: p.id, patch: { d: "M 0 0 L 10.0004 0" } }]);
    expect(shape(doc, p.id)).toMatchObject({ d: "M 0 0 L 10 0" });
  });

  it.each([
    [{ transform: [1, 0, 0, 1, 0, 0] }, "transform", /node_transform/],
    [{ parentId: "x" }, "parentId", /reparent/i],
    [{ type: "ellipse" }, "type", /type/],
    [{ sides: 5 }, "sides", /x, y, width, height, radius/],
    [{ d: "M 0 0" }, "d", /parameters/],
    [{ name: null }, "name", /null/],
    [{ width: -1 }, "width", /./],
  ])("rejects %j with INVALID_PATCH", (patch, key, hint) => {
    const { doc, r } = setup();
    expect(errorOf(() => updateNodes(doc, [{ nodeId: r.id, patch }]))).toMatchObject({
      code: "INVALID_PATCH",
      path: `updates[0].patch.${key}`,
      hint: expect.stringMatching(hint),
    });
  });

  it("rejects appearance on a Group", () => {
    const { doc, defaultLayerId } = setup();
    expect(
      errorOf(() => updateNodes(doc, [{ nodeId: defaultLayerId, patch: { appearance: {} } }])),
    ).toMatchObject({ code: "INVALID_PATCH", path: "updates[0].patch.appearance" });
  });

  it("reports INVALID_COLOR and INVALID_PATH at the patch path", () => {
    const { doc, r, p } = setup();
    expect(
      errorOf(() =>
        updateNodes(doc, [{ nodeId: r.id, patch: { appearance: { fills: [{ color: "red" }] } } }]),
      ),
    ).toMatchObject({
      code: "INVALID_COLOR",
      path: "updates[0].patch.appearance.fills[0].color",
      hint: expect.stringContaining("#FF0000"),
    });
    expect(
      errorOf(() => updateNodes(doc, [{ nodeId: p.id, patch: { d: "M 0 0 h 1" } }])),
    ).toMatchObject({ code: "INVALID_PATH", path: "updates[0].patch.d" });
  });

  it("applies two patches to one Node in order", () => {
    const { doc, r } = setup();
    updateNodes(doc, [
      { nodeId: r.id, patch: { name: "a" } },
      { nodeId: r.id, patch: { opacity: 0.5 } },
    ]);
    expect(doc.nodes.get(r.id)).toMatchObject({ name: "a", opacity: 0.5 });
  });

  it("changes nothing when one item fails", () => {
    const { doc, r } = setup();
    expect(
      errorOf(() =>
        updateNodes(doc, [
          { nodeId: r.id, patch: { name: "changed" } },
          { nodeId: "nope", patch: { name: "x" } },
        ]),
      ),
    ).toMatchObject({ code: "NODE_NOT_FOUND", path: "updates[1].nodeId" });
    expect(doc.nodes.get(r.id)?.name).toBe("");
  });
});

describe("deleteNodes", () => {
  it("deletes a Group with its descendants, each id once", () => {
    const { doc, defaultLayerId, rect } = newDoc();
    const [g, a, inner, b] = createNodes(doc, [
      {
        type: "group",
        parentId: defaultLayerId,
        children: [
          { type: "rect", x: 0, y: 0, width: 10, height: 10 },
          { type: "group", children: [{ type: "line", x1: 0, y1: 0, x2: 50, y2: 5 }] },
        ],
      },
      rect(100, 0),
    ]).nodes;
    if (!g || !a || !inner || !b) throw new Error("setup");
    const { deletedIds, bounds } = deleteNodes(doc, [g.id, b.id]);
    expect(deletedIds).toEqual([g.id, a.id, inner.id, b.id]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 50, height: 10 });
    expect(outline(doc)).toMatchObject([{ id: defaultLayerId, childCount: 1 }]);
    expect([...doc.nodes.keys()]).not.toContain(b.id);
  });

  it("allows deleting the last Layer; a new top-level Layer can follow", () => {
    const { doc, defaultLayerId } = newDoc();
    deleteNodes(doc, [defaultLayerId]);
    expect(outline(doc)).toEqual([]);
    createNodes(doc, [{ type: "layer" }]);
    expect(outline(doc)).toHaveLength(1);
  });

  it("returns NODE_NOT_FOUND for an unknown id and deletes nothing", () => {
    const { doc, defaultLayerId } = newDoc();
    expect(errorOf(() => deleteNodes(doc, [defaultLayerId, "nope"]))).toMatchObject({
      code: "NODE_NOT_FOUND",
      path: "nodeIds[1]",
    });
    expect(doc.nodes.has(defaultLayerId)).toBe(true);
  });
});

describe("partial", () => {
  it("applies the valid items and reports the rest by index", () => {
    const { doc, rect } = newDoc();
    const [a] = createNodes(doc, [rect(0, 0)]).nodes;
    if (!a) throw new Error("setup");
    const { nodes, failed } = updateNodes(
      doc,
      [
        { nodeId: a.id, patch: { name: "ok" } },
        { nodeId: "nope", patch: { name: "x" } },
        { nodeId: a.id, patch: { appearance: { fills: [{ color: "red" }] } } },
      ],
      { partial: true },
    );
    expect(nodes.map((n) => n.id)).toEqual([a.id]);
    expect(doc.nodes.get(a.id)?.name).toBe("ok");
    expect(failed).toEqual([
      expect.objectContaining({ index: 1, code: "NODE_NOT_FOUND", path: "updates[1].nodeId" }),
      expect.objectContaining({
        index: 2,
        code: "INVALID_COLOR",
        path: "updates[2].patch.appearance.fills[0].color",
        hint: expect.any(String),
      }),
    ]);
  });

  it("does the same for delete and transform, and throws when nothing applies", () => {
    const { doc, rect } = newDoc();
    const [a, b] = createNodes(doc, [rect(0, 0), rect(0, 50)]).nodes;
    if (!a || !b) throw new Error("setup");
    const moved = transformNodes(
      doc,
      { nodeIds: ["nope", a.id], translate: { x: 1 } },
      { partial: true },
    );
    expect(moved.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(moved.failed).toMatchObject([{ index: 0, code: "NODE_NOT_FOUND" }]);
    const gone = deleteNodes(doc, [b.id, "nope"], { partial: true });
    expect(gone.deletedIds).toEqual([b.id]);
    expect(gone.failed).toMatchObject([{ index: 1, path: "nodeIds[1]" }]);
    expect(errorOf(() => deleteNodes(doc, ["x", "y"], { partial: true }))).toMatchObject({
      code: "NODE_NOT_FOUND",
      path: "nodeIds[0]",
    });
  });
});
