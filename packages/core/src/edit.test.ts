import { describe, expect, it } from "vitest";
import { bounds, createDocument, createNodes } from "./document.ts";
import { transformNodes } from "./edit.ts";
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
