import { expect, it } from "vitest";
import { createDocument, createNodes } from "./document.ts";
import { serializeDocument } from "./file.ts";
import type { Document } from "./schema.ts";

/** A Layer holding a Group (a rect and a text) and a path. */
function scene(): Document {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
  });
  createNodes(doc, [
    {
      type: "group",
      parentId: defaultLayerId,
      children: [
        { type: "rect", x: 10, y: 10, width: 50, height: 30, meta: { z: 1, a: 2 } },
        { type: "text", x: 10, y: 80, content: "Hi" },
      ],
    },
    { type: "path", parentId: defaultLayerId, d: "M 0 0 L 10 0 L 10 10 Z" },
  ]);
  return doc;
}

const sorted = (keys: string[]) => [...keys].sort();

it("serialises version, name, artboards and nodes, sorted, with a final newline", () => {
  const text = serializeDocument(scene());
  expect(text.startsWith('{\n  "version": 1,\n  "name": "Doc",')).toBe(true);
  expect(text.endsWith("}\n")).toBe(true);
  const file = JSON.parse(text);
  expect(Object.keys(file)).toEqual(["version", "name", "artboards", "nodes"]);
  const ids = file.nodes.map((n: { id: string }) => n.id);
  expect(ids).toEqual(sorted(ids));
  expect(ids).toHaveLength(5);
  for (const node of file.nodes) {
    expect(Object.keys(node)).toEqual(sorted(Object.keys(node)));
    for (const fill of node.appearance?.fills ?? []) {
      expect(Object.keys(fill)).toEqual(sorted(Object.keys(fill)));
    }
  }
  expect(Object.keys(file.nodes.find((n: { type: string }) => n.type === "rect").meta)).toEqual([
    "a",
    "z",
  ]);
  expect(file).not.toHaveProperty("id");
  expect(file).not.toHaveProperty("rev");
});

it("gives the same text however the Nodes' keys were ordered", () => {
  const doc = scene();
  const reordered: Document = {
    ...doc,
    rev: 7,
    nodes: new Map(
      [...doc.nodes]
        .reverse()
        .map(([id, n]) => [id, Object.fromEntries(Object.entries(n).reverse())]),
    ) as Document["nodes"],
  };
  expect(serializeDocument(reordered)).toBe(serializeDocument(doc));
});
