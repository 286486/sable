import { createDocument, createNodes, type Node } from "@zibel/core";
import { describe, expect, it } from "vitest";
import { combine, inverse, marquee, objectOf, objects, selectable } from "./selection.ts";

/**
 * Layer 1: Group g (rects a, b), rect c, hidden rect h, locked Group lg (rect m), Layer 3 (rect e).
 * Layer 2: rect d.
 */
function fixture() {
  const { doc, defaultLayerId: l1 } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  const rect = (clientKey: string, x: number) =>
    ({ type: "rect", clientKey, x, y: 0, width: 10, height: 10 }) as const;
  const at = (parentId: string) => (key: string, x: number) => ({ ...rect(key, x), parentId });
  const { keyMap } = createNodes(doc, [
    { type: "group", clientKey: "g", parentId: l1, children: [rect("a", 0), rect("b", 20)] },
    at(l1)("c", 40),
    at(l1)("h", 60),
    { type: "group", clientKey: "lg", parentId: l1, children: [rect("m", 80)] },
    { type: "layer", clientKey: "l3", parentId: l1 },
    { type: "layer", clientKey: "l2" },
  ]);
  const id = (key: string) => keyMap[key] as string;
  Object.assign(keyMap, createNodes(doc, [at(id("l3"))("e", 100), at(id("l2"))("d", 120)]).keyMap);
  const set = (key: string, patch: Partial<Node>) =>
    doc.nodes.set(id(key), { ...(doc.nodes.get(id(key)) as Node), ...patch } as Node);
  set("h", { visible: false });
  set("lg", { locked: true });
  return { doc, id, node: (key: string) => doc.nodes.get(id(key)) as Node };
}

describe("objectOf", () => {
  it("is the outermost Group below the Layer, or the Node itself", () => {
    const { doc, id, node } = fixture();
    expect(objectOf(doc, node("a"))?.id).toBe(id("g"));
    expect(objectOf(doc, node("c"))?.id).toBe(id("c"));
    expect(objectOf(doc, node("e"))?.id).toBe(id("e"));
    expect(objectOf(doc, node("l3"))).toBeNull();
  });
});

it("selectable needs the Node and every ancestor visible and unlocked", () => {
  const { doc, node } = fixture();
  expect(["a", "c", "e"].map((k) => selectable(doc, node(k)))).toEqual([true, true, true]);
  expect(["h", "m"].map((k) => selectable(doc, node(k)))).toEqual([false, false]);
});

describe("objects", () => {
  it("skips hidden and locked objects and what is inside them", () => {
    const { doc, id } = fixture();
    const keys = ["g", "c", "e", "d"];
    expect(objects(doc).map((n) => n.id)).toEqual(expect.arrayContaining(keys.map(id)));
    expect(objects(doc)).toHaveLength(keys.length);
  });

  it("skips everything in a hidden Layer", () => {
    const { doc, id, node } = fixture();
    doc.nodes.set(id("l2"), { ...node("l2"), visible: false });
    expect(objects(doc).map((n) => n.id)).not.toContain(id("d"));
  });
});

describe("combine", () => {
  it("replaces, toggles with Shift and removes with Alt+Shift", () => {
    const plain = { shift: false, alt: false };
    expect(combine(["x", "y"], ["z"], plain)).toEqual(["z"]);
    expect(combine(["x", "y"], [], plain)).toEqual([]);
    expect(combine(["x", "y"], ["y", "z"], { shift: true, alt: false })).toEqual(["x", "z"]);
    expect(combine(["x", "y"], ["y", "z"], { shift: true, alt: true })).toEqual(["x"]);
    expect(combine(["x"], [], { shift: true, alt: false })).toEqual(["x"]);
  });
});

describe("marquee", () => {
  it("takes every selectable object whose bounds it touches", () => {
    const { doc, id } = fixture();
    // x 5..45 touches a (in g), b (in g) and c's left edge at 40; not h, m or e.
    const hit = marquee(doc, { x: 5, y: 5, width: 35, height: 10 });
    expect(hit.sort()).toEqual([id("g"), id("c")].sort());
    expect(marquee(doc, { x: 55, y: 0, width: 40, height: 10 })).toEqual([]);
  });
});

it("inverse selects the other selectable objects", () => {
  const { doc, id } = fixture();
  expect(inverse(doc, [id("g"), id("d")]).sort()).toEqual([id("c"), id("e")].sort());
});
