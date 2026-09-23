import { createDocument, createNodes, type Node } from "@zibel/core";
import { expect, it } from "vitest";
import { autoName, rows } from "./layers.ts";

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
  const rect = (clientKey: string) =>
    ({ type: "rect", clientKey, x: 0, y: 0, width: 10, height: 10 }) as const;
  const at = (parentId: string) => (key: string) => ({ ...rect(key), parentId });
  const { keyMap } = createNodes(doc, [
    { type: "group", clientKey: "g", parentId: l1, children: [rect("a"), rect("b")] },
    at(l1)("c"),
    at(l1)("h"),
    { type: "group", clientKey: "lg", parentId: l1, children: [rect("m")] },
    { type: "layer", clientKey: "l3", parentId: l1 },
    { type: "layer", clientKey: "l2" },
  ]);
  keyMap.l1 = l1;
  const id = (key: string) => keyMap[key] as string;
  Object.assign(keyMap, createNodes(doc, [at(id("l3"))("e"), at(id("l2"))("d")]).keyMap);
  const set = (key: string, patch: Partial<Node>) =>
    doc.nodes.set(id(key), { ...(doc.nodes.get(id(key)) as Node), ...patch } as Node);
  set("h", { visible: false });
  set("lg", { locked: true });
  const key = (nodeId: string) => Object.keys(keyMap).find((k) => keyMap[k] === nodeId);
  return { doc, id, key };
}

it("lists siblings topmost first, Layers expanded and Groups collapsed", () => {
  const { doc, id, key } = fixture();
  const out = rows(doc, new Set());
  expect(out.map((r) => key(r.node.id))).toEqual(["l2", "d", "l1", "l3", "e", "lg", "h", "c", "g"]);
  expect(out.map((r) => r.depth)).toEqual([0, 1, 0, 1, 2, 1, 1, 1, 1]);
  const g = out.find((r) => r.node.id === id("g"));
  expect(g).toMatchObject({ expandable: true, expanded: false });
  expect(out.find((r) => r.node.id === id("c"))).toMatchObject({ expandable: false });
});

it("expands a toggled Group and collapses a toggled Layer", () => {
  const { doc, id, key } = fixture();
  const keys = (toggled: string[]) =>
    rows(doc, new Set(toggled.map(id))).map((r) => `${key(r.node.id)}:${r.depth}`);
  expect(keys(["g"]).slice(-3)).toEqual(["g:1", "b:2", "a:2"]);
  expect(keys(["l1"])).toEqual(["l2:0", "d:1", "l1:0"]);
});

it("dims every row hidden or locked, itself or through an ancestor", () => {
  const { doc, id, key } = fixture();
  const dimmed = rows(doc, new Set([id("lg")]))
    .filter((r) => r.dimmed)
    .map((r) => key(r.node.id));
  expect(dimmed).toEqual(["lg", "m", "h"]);
});

it("auto-names each type of unnamed Node", () => {
  const types = ["rect", "ellipse", "line", "polygon", "star", "path", "group", "layer"] as const;
  expect(types.map((type) => autoName({ type } as Node))).toEqual([
    "<Rectangle>",
    "<Ellipse>",
    "<Line>",
    "<Polygon>",
    "<Star>",
    "<Path>",
    "<Group>",
    "<Layer>",
  ]);
});

it("offers no disclosure for an empty container", () => {
  const { doc, id } = fixture();
  doc.nodes.delete(id("e"));
  expect(rows(doc, new Set()).find((r) => r.node.id === id("l3"))).toMatchObject({
    expandable: false,
    expanded: false,
  });
});

it("auto-names a text by its content", () => {
  expect(autoName({ type: "text", content: "Q3 revenue" } as Node)).toBe("Q3 revenue");
});
