import { describe, expect, it } from "vitest";
import { bounds, childrenOf, createDocument, createNodes, visibleBounds } from "./document.ts";
import { placeNodes } from "./place.ts";
import type { Node, ShapeNode } from "./schema.ts";

/** The Nodes of a file with two Layers, a rect in each and a sub-Layer in the first, as Open reads it. */
function file() {
  const { doc, defaultLayerId } = createDocument({ id: "f", name: "F", artboards: [] });
  const [second, sub] = createNodes(doc, [
    { type: "layer", name: "Top" },
    { type: "layer", parentId: defaultLayerId, name: "Sub" },
  ]).nodes as [Node, Node];
  const rect = (parentId: string, x: number) => ({
    type: "rect" as const,
    parentId,
    x,
    y: 0,
    width: 20,
    height: 10,
    appearance: { fills: [], strokes: [{ color: "#000000", width: 2 }] },
  });
  createNodes(doc, [rect(defaultLayerId, 0), rect(second.id, 20), rect(sub.id, 30)]);
  return { name: "Logo", nodes: [...doc.nodes.values()] };
}

const setup = (artboards = [{ width: 200, height: 100 }]) =>
  createDocument({ id: "d", name: "Doc", artboards });

describe("placeNodes", () => {
  it("puts the file's Layers, as Groups with new ids, into one Group above the parent's children", () => {
    const { doc, defaultLayerId } = setup();
    createNodes(doc, [{ type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 5, height: 5 }]);
    const f = file();
    const { groupId, created } = placeNodes(doc, f, { parentId: defaultLayerId });

    const group = doc.nodes.get(groupId) as Node;
    expect(group).toMatchObject({ type: "group", name: "Logo", parentId: defaultLayerId });
    expect(childrenOf(doc, defaultLayerId).at(-1)?.id).toBe(groupId);
    expect(created[0]?.id).toBe(groupId);
    expect(created).toHaveLength(f.nodes.length + 1);
    const kids = childrenOf(doc, groupId);
    expect(kids.map((n) => [n.type, n.name])).toEqual([
      ["group", "Layer 1"],
      ["group", "Top"],
    ]);
    const sub = childrenOf(doc, kids[0]?.id as string).find((n) => n.name === "Sub");
    expect(sub?.type).toBe("group");
    expect(created.some((n) => n.type === "layer")).toBe(false);
    const old = new Set(f.nodes.map((n) => n.id));
    expect(created.filter((n) => old.has(n.id))).toEqual([]);
    // What `created` carries is what the Document holds, transformed leaves included.
    for (const n of created) expect(doc.nodes.get(n.id)).toEqual(n);
  });

  it("centres the Group on the parent's Artboard by default, or on position", () => {
    const { doc, defaultLayerId } = setup();
    const { groupId } = placeNodes(doc, file(), { parentId: defaultLayerId });
    // The file's rects span x 0..50, y 0..10.
    expect(bounds(doc, doc.nodes.get(groupId) as Node)).toEqual({
      x: 75,
      y: 45,
      width: 50,
      height: 10,
    });
    const at = placeNodes(doc, file(), { parentId: defaultLayerId, position: { x: 10, y: 20 } });
    expect(bounds(doc, doc.nodes.get(at.groupId) as Node)).toEqual({
      x: -15,
      y: 15,
      width: 50,
      height: 10,
    });
  });

  it("fit scales uniformly, Strokes included, to fit the parent's Artboard", () => {
    const { doc, defaultLayerId } = setup();
    const { groupId, created } = placeNodes(doc, file(), { parentId: defaultLayerId, fit: true });
    const b = bounds(doc, doc.nodes.get(groupId) as Node);
    expect(b?.x).toBeCloseTo(0);
    expect(b?.y).toBeCloseTo(30);
    expect(b?.width).toBeCloseTo(200);
    expect(b?.height).toBeCloseTo(40);
    const leaf = created.find((n) => n.type === "rect") as ShapeNode;
    expect(leaf.appearance.strokes[0]?.width).toBe(2);
    expect(visibleBounds(doc, leaf)?.height).toBeCloseTo(40 + 8);
  });

  it("uses the Artboard the parent overlaps most, else the first", () => {
    const { doc, defaultLayerId } = setup([
      { width: 200, height: 100 },
      { width: 100, height: 100 },
    ]);
    // An empty parent: the first Artboard.
    const first = placeNodes(doc, file(), { parentId: defaultLayerId });
    expect(bounds(doc, doc.nodes.get(first.groupId) as Node)?.x).toBe(75);

    const [layer] = createNodes(doc, [{ type: "layer", name: "Right" }]).nodes as [Node];
    // The second Artboard sits at x 220..320.
    createNodes(doc, [{ type: "rect", parentId: layer.id, x: 230, y: 10, width: 5, height: 5 }]);
    const second = placeNodes(doc, file(), { parentId: layer.id });
    expect(bounds(doc, doc.nodes.get(second.groupId) as Node)).toMatchObject({ x: 245, y: 45 });
  });

  it("places an empty file as an empty Group", () => {
    const { doc, defaultLayerId } = setup();
    const empty = createDocument({ id: "e", name: "E", artboards: [] }).doc;
    const { groupId, created } = placeNodes(
      doc,
      { name: "Empty", nodes: [...empty.nodes.values()] },
      { parentId: defaultLayerId, fit: true },
    );
    expect(created.map((n) => n.type)).toEqual(["group", "group"]);
    expect(childrenOf(doc, groupId)).toHaveLength(1);
  });

  it("follows node_create's parent rule", () => {
    const { doc, defaultLayerId } = setup();
    const [rect] = createNodes(doc, [
      { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 5, height: 5 },
    ]).nodes as [Node];
    expect(() => placeNodes(doc, file(), { parentId: rect.id })).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ code: "INVALID_PARENT" }) }),
    );
    expect(() => placeNodes(doc, file(), { parentId: doc.artboards[0]?.id as string })).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ code: "INVALID_PARENT" }) }),
    );
    expect(() => placeNodes(doc, file(), { parentId: "nope" })).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ code: "NODE_NOT_FOUND" }) }),
    );
  });
});
