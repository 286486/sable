import { describe, expect, it } from "vitest";
import { childrenOf, createDocument, createNodes } from "./document.ts";
import { replaceMerge } from "./replace.ts";
import type { Document, Node, ShapeNode } from "./schema.ts";

const setup = () => {
  const { doc, defaultLayerId } = createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  const rect = { type: "rect" as const, parentId: defaultLayerId, y: 0, width: 10, height: 10 };
  const [a, b, c, group] = createNodes(doc, [
    { ...rect, x: 0, name: "a" },
    { ...rect, x: 20, name: "b" },
    { ...rect, x: 40, name: "c" },
    {
      type: "group",
      parentId: defaultLayerId,
      children: [{ type: "rect", x: 60, y: 0, width: 10, height: 10 }],
    },
  ]).nodes as [ShapeNode, ShapeNode, ShapeNode, Node, ShapeNode];
  return { doc, layer: defaultLayerId, a, b, c, group };
};

const copy = (doc: Document): Document => ({ ...doc, nodes: new Map(doc.nodes) });

/** The file as an unedited export gives it: every Node of `doc`. */
const fileOf = (doc: Document) => ({ artboards: doc.artboards, nodes: [...doc.nodes.values()] });

const edit = (file: ReturnType<typeof fileOf>, id: string, patch: Partial<ShapeNode>) => ({
  ...file,
  nodes: file.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)),
});

const without = (file: ReturnType<typeof fileOf>, id: string) => ({
  ...file,
  nodes: file.nodes.filter((n) => n.id !== id),
});

const red = { fills: [{ type: "solid" as const, color: "#FF0000FF" }], strokes: [] };

describe("replaceMerge", () => {
  it("changes nothing for an unedited file", () => {
    const { doc } = setup();
    const base = copy(doc);
    const out = replaceMerge(doc, { base, current: base }, fileOf(base));
    expect(out).toEqual({ created: [], updated: [], deletedIds: [], skipped: [] });
  });

  it("applies what the file changed and keeps what the Document changed since, per property", () => {
    const { doc, a, b, c } = setup();
    const base = copy(doc);
    // An Agent moved a and renamed b after the export.
    doc.nodes.set(a.id, { ...a, x: 5 } as Node);
    doc.nodes.set(b.id, { ...b, name: "agent" });
    let file = edit(fileOf(base), b.id, { appearance: red });
    file = edit(file, c.id, { name: "file" });
    const out = replaceMerge(doc, { base, current: copy(doc) }, file);
    expect(out.updated.map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
    expect(doc.nodes.get(a.id)).toMatchObject({ x: 5 });
    expect(doc.nodes.get(b.id)).toMatchObject({ name: "agent", appearance: red });
    expect(doc.nodes.get(c.id)).toMatchObject({ name: "file" });
  });

  it("takes the file's value where both sides changed the same property", () => {
    const { doc, a } = setup();
    const base = copy(doc);
    doc.nodes.set(a.id, { ...a, name: "agent" });
    replaceMerge(doc, { base, current: copy(doc) }, edit(fileOf(base), a.id, { name: "file" }));
    expect(doc.nodes.get(a.id)).toMatchObject({ name: "file" });
  });

  it("compares in normalised form, so a moved Node lands where the file says, not twice moved", () => {
    const { doc, a } = setup();
    // Stored with its move in the matrix; export and import bake it into x.
    doc.nodes.set(a.id, { ...a, transform: [1, 0, 0, 1, 5, 0] });
    const norm = copy(doc);
    norm.nodes.set(a.id, { ...a, x: 5 } as Node);
    replaceMerge(doc, { base: norm, current: norm }, edit(fileOf(norm), a.id, { x: 15 }));
    expect(doc.nodes.get(a.id)).toMatchObject({ x: 15, transform: [1, 0, 0, 1, 0, 0] });
  });

  it("keeps a Node the Document deleted since, even when the file edited it, and reports it", () => {
    const { doc, a } = setup();
    const base = copy(doc);
    doc.nodes.delete(a.id);
    const out = replaceMerge(
      doc,
      { base, current: copy(doc) },
      edit(fileOf(base), a.id, { name: "file" }),
    );
    expect(out.skipped).toEqual([a.id]);
    expect(doc.nodes.has(a.id)).toBe(false);
  });

  it("deletes only Nodes the base export contained", () => {
    const { doc, layer, a } = setup();
    const base = copy(doc);
    const [d] = createNodes(doc, [
      { type: "rect", parentId: layer, x: 80, y: 0, width: 5, height: 5 },
    ]).nodes as [Node];
    const out = replaceMerge(doc, { base, current: copy(doc) }, without(fileOf(base), a.id));
    expect(out.deletedIds).toEqual([a.id]);
    expect(doc.nodes.has(d.id)).toBe(true);
  });

  it("at nodeIds scope deletes only the listed Nodes, not the Layer written as the way to them", () => {
    const { doc, layer, a, b } = setup();
    const base = copy(doc);
    // A nodeIds export of a holds a and, as the way to it, its Layer.
    const scoped = {
      artboards: [],
      nodes: [base.nodes.get(layer), base.nodes.get(a.id)] as Node[],
    };
    const scopedBase = { ...base, nodes: new Map(scoped.nodes.map((n) => [n.id, n])) };
    const out = replaceMerge(
      doc,
      { base: scopedBase, current: scopedBase },
      { artboards: [], nodes: [] },
      { nodeIds: [a.id] },
    );
    expect(out.deletedIds).toEqual([a.id]);
    expect(doc.nodes.has(layer)).toBe(true);
    expect(doc.nodes.has(b.id)).toBe(true);
  });

  it("creates a Node the file added, after its siblings, and one under a deleted parent is skipped", () => {
    const { doc, layer, c, group } = setup();
    const base = copy(doc);
    doc.nodes.delete(group.id);
    const n = (id: string, parentId: string): Node => ({ ...c, id, parentId, index: "zz" });
    const file = fileOf(base);
    file.nodes.push(n("NEW", layer), n("LOST", group.id));
    const out = replaceMerge(doc, { base, current: copy(doc) }, file);
    expect(out.created.map((x) => x.id)).toEqual(["NEW"]);
    expect(out.skipped).toEqual(["LOST"]);
    expect(childrenOf(doc, layer).at(-1)?.id).toBe("NEW");
  });

  it("applies the file's stacking order, changing only the moved Node's index", () => {
    const { doc, layer, a, b, c, group } = setup();
    const base = copy(doc);
    // The file puts a on top: it is last in document order.
    const keys = ["a0", "a1", "a2", "a3"];
    const order = [b.id, c.id, group.id, a.id];
    const file = fileOf(base);
    file.nodes = file.nodes.map((n) =>
      n.parentId === layer ? { ...n, index: keys[order.indexOf(n.id)] as string } : n,
    );
    const out = replaceMerge(doc, { base, current: base }, file);
    expect(childrenOf(doc, layer).map((n) => n.id)).toEqual(order);
    expect(out.updated.map((n) => n.id)).toEqual([a.id]);
  });

  it("updates an Artboard the file changed", () => {
    const { doc } = setup();
    const base = copy(doc);
    const [board] = base.artboards as [Document["artboards"][number]];
    const file = { ...fileOf(base), artboards: [{ ...board, name: "Cover" }] };
    const out = replaceMerge(doc, { base, current: base }, file);
    expect(out.artboards).toEqual([{ ...board, name: "Cover" }]);
  });
});
