import { expect, it } from "vitest";
import { createDocument, createNodes, outline } from "./document.ts";
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
  const [node] = createNodes(doc, [rect(defaultLayerId)]);
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
  ]);
  createNodes(doc, [rect(defaultLayerId)]);
  const ids = outline(doc)[0]?.children?.map((c) => c.id);
  expect(ids?.slice(0, 3)).toEqual(created.map((n) => n.id));
  expect(ids).toHaveLength(4);
});

it("rejects a parent that is not a Layer or Group with INVALID_PARENT", () => {
  const { doc, defaultLayerId } = newDoc();
  const [r] = createNodes(doc, [rect(defaultLayerId)]);
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
