import { describe, expect, it } from "vitest";
import { createDocument, createNodes } from "./document.ts";
import { ZibelError } from "./errors.ts";
import type { Document, Node, ShapeNode } from "./schema.ts";
import { commitTransaction, overlay, type TxRow } from "./tx.ts";

const setup = () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  const [rect, group, child] = createNodes(doc, [
    { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 10, height: 10, name: "a" },
    {
      type: "group",
      parentId: defaultLayerId,
      children: [{ type: "ellipse", x: 0, y: 0, width: 5, height: 5 }],
    },
  ]).nodes as [ShapeNode, Node, ShapeNode];
  return { doc, defaultLayerId, rect, group, child };
};

const copy = (doc: Document): Document => ({ ...doc, nodes: new Map(doc.nodes) });

const nodeGone = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

describe("overlay", () => {
  it("lays working copies over the committed Document and leaves it untouched", () => {
    const { doc, rect, child } = setup();
    const renamed = { ...rect, name: "b" };
    const view = overlay(doc, [
      { id: rect.id, base: rect, working: renamed },
      { id: child.id, base: child, working: null },
    ]);
    expect(view.nodes.get(rect.id)).toEqual(renamed);
    expect(view.nodes.has(child.id)).toBe(false);
    expect(doc.nodes.get(rect.id)).toBe(rect);
    expect(doc.nodes.has(child.id)).toBe(true);
  });
});

describe("commitTransaction", () => {
  it("applies only the keys the Transaction changed onto the Node as committed now", () => {
    const { doc, rect } = setup();
    const appearance = { fills: [{ type: "solid" as const, color: "#FF0000FF" }], strokes: [] };
    const working = { ...rect, appearance };
    // A person renamed it after the Transaction touched it.
    doc.nodes.set(rect.id, { ...rect, name: "z" });
    const { updated } = commitTransaction(doc, [{ id: rect.id, base: rect, working }]);
    expect(doc.nodes.get(rect.id)).toMatchObject({ name: "z", appearance });
    expect(updated.map((n) => n.id)).toEqual([rect.id]);
  });

  it("compares values structurally, so reordered keys are not a change", () => {
    const { doc, rect } = setup();
    const { fills, strokes } = rect.appearance;
    const working = { ...rect, appearance: { strokes, fills }, name: "b" };
    const personal = { fills: [], strokes: [] };
    doc.nodes.set(rect.id, { ...rect, appearance: personal });
    commitTransaction(doc, [{ id: rect.id, base: rect, working }]);
    expect(doc.nodes.get(rect.id)).toMatchObject({ name: "b", appearance: personal });
  });

  it("removes a key the Transaction removed", () => {
    const { doc, rect } = setup();
    const base = { ...rect, radius: 4 } as Node;
    doc.nodes.set(rect.id, base);
    const { radius: _, ...working } = base as ShapeNode & { radius?: number };
    commitTransaction(doc, [{ id: rect.id, base, working: working as Node }]);
    expect(doc.nodes.get(rect.id)).not.toHaveProperty("radius");
  });

  it("classifies rows as created, updated or deleted and skips created-then-deleted", () => {
    const { doc, rect, child } = setup();
    const before = copy(doc);
    const fresh = { ...rect, id: "new" };
    const { created, updated, deletedIds } = commitTransaction(doc, [
      { id: "new", base: null, working: fresh },
      { id: "tmp", base: null, working: null },
      { id: rect.id, base: rect, working: { ...rect, name: "b" } },
      { id: child.id, base: child, working: null },
    ]);
    expect(created.map((n) => n.id)).toEqual(["new"]);
    expect(updated.map((n) => n.id)).toEqual([rect.id]);
    expect(deletedIds).toEqual([child.id]);
    expect(doc.nodes.has("new")).toBe(true);
    expect(doc.nodes.has("tmp")).toBe(false);
    expect(doc.nodes.has(child.id)).toBe(false);
    expect(doc.nodes.size).toBe(before.nodes.size);
  });

  it("deletes a deleted Node's descendants as committed at commit time", () => {
    const { doc, group, child } = setup();
    // Someone added a second child after the Transaction deleted the Group.
    const late = { ...child, id: "late" };
    doc.nodes.set(late.id, late);
    const { deletedIds } = commitTransaction(doc, [
      { id: group.id, base: group, working: null },
      { id: child.id, base: child, working: null },
    ]);
    expect(new Set(deletedIds)).toEqual(new Set([group.id, child.id, "late"]));
    expect(deletedIds).toHaveLength(3);
    expect(doc.nodes.has("late")).toBe(false);
  });

  it("treats a Node deleted both inside and outside as deleted, not gone", () => {
    const { doc, child } = setup();
    doc.nodes.delete(child.id);
    const { deletedIds } = commitTransaction(doc, [{ id: child.id, base: child, working: null }]);
    expect(deletedIds).toEqual([]);
  });

  it("fails with NODE_GONE and changes nothing when an edited Node was deleted outside", () => {
    const { doc, rect, child } = setup();
    doc.nodes.delete(rect.id);
    const before = copy(doc);
    const rows: TxRow[] = [
      { id: child.id, base: child, working: { ...child, name: "c" } },
      { id: rect.id, base: rect, working: { ...rect, name: "b" } },
    ];
    expect(nodeGone(() => commitTransaction(doc, rows))).toMatchObject({
      code: "NODE_GONE",
      nodeIds: [rect.id],
    });
    expect(doc.nodes).toEqual(before.nodes);
  });

  it("fails with NODE_GONE listing a created Node's parent that was deleted outside", () => {
    const { doc, group, child } = setup();
    doc.nodes.delete(group.id);
    doc.nodes.delete(child.id);
    const fresh = { ...child, id: "new", parentId: group.id };
    expect(
      nodeGone(() => commitTransaction(doc, [{ id: "new", base: null, working: fresh }])),
    ).toMatchObject({ code: "NODE_GONE", nodeIds: [group.id] });
    expect(doc.nodes.has("new")).toBe(false);
  });

  it("commits a created Node whose parent was created in the same Transaction", () => {
    const { doc, group, child } = setup();
    const g = { ...group, id: "g" };
    const c = { ...child, id: "c", parentId: "g" };
    const { created } = commitTransaction(doc, [
      { id: "g", base: null, working: g },
      { id: "c", base: null, working: c },
    ]);
    expect(created.map((n) => n.id)).toEqual(["g", "c"]);
  });
});
