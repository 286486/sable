import {
  bounds,
  childrenOf,
  createDocument,
  createNodes,
  type Document,
  makeMask,
  type Node,
  parseDocument,
  type RenderScope,
  serializeDocument,
} from "@zibel/core";
import { describe, expect, it, vi } from "vitest";
import { parseFile } from "./index.ts";
import { replaceFile } from "./replace.ts";
import { toSvg } from "./write.ts";

const blue = { fills: [{ color: "#0000FF" }], strokes: [] };
const red = { fills: [{ type: "solid" as const, color: "#FF0000" }], strokes: [] };

/** Squares a, b, c side by side, a triangle Path p and a Group holding one square. */
function setup(id = "DOC") {
  const { doc, defaultLayerId: layer } = createDocument({
    id,
    name: "Doc",
    artboards: [{ width: 200, height: 100 }],
  });
  const square = { type: "rect" as const, parentId: layer, y: 0, width: 10, height: 10 };
  const [a, b, c, p, group] = createNodes(doc, [
    { ...square, x: 0, name: "a", appearance: blue },
    { ...square, x: 20, name: "b", appearance: blue },
    { ...square, x: 40, name: "c", appearance: blue },
    { type: "path", parentId: layer, d: "M 0 50 L 9 50 L 9 59 Z" },
    {
      type: "group",
      parentId: layer,
      children: [{ type: "rect", x: 60, y: 0, width: 10, height: 10 }],
    },
  ]).nodes as [Node, Node, Node, Node, Node];
  doc.rev = 1;
  return { doc, layer, a, b, c, p, group };
}

/**
 * The Document as exported now: its SVG in `scope`, and a `rebuild` that gives back this rev, as
 * the Delta Log would. A deep copy, so edits made since do not reach the base.
 */
function exportNow(doc: Document) {
  const base = structuredClone(doc);
  return {
    svg: (scope?: RenderScope) => toSvg(base, undefined, { scope }),
    rebuild: vi.fn((rev: number) => (rev === base.rev ? structuredClone(base) : null)),
  };
}

/** An edit made by an Agent after the export: it commits one rev. */
const since = (doc: Document, edit: () => void) => {
  edit();
  doc.rev++;
};

const set = (doc: Document, node: Node, patch: object) =>
  doc.nodes.set(node.id, { ...(doc.nodes.get(node.id) as Node), ...patch } as Node);

/** The element written for Node `id`. */
const element = (id: string) => new RegExp(`<[a-z]+ [^>]*\\bid="z-${id}"[^>]*/>`);
const recolour = (svg: string, id: string, color: string) =>
  svg.replace(element(id), (e) => e.replace(/fill="[^"]*"/, `fill="${color}"`));
const remove = (svg: string, id: string) => svg.replace(element(id), "");
/** Appends markup as the last child of the top Layer, which the export writes last. */
const append = (svg: string, markup: string) => svg.replace(/<\/g><\/svg>$/, `${markup}</g></svg>`);

const replace = (doc: Document, text: string, opts: Parameters<typeof replaceFile>[2]) =>
  replaceFile(doc, parseFile(text), opts);

const x = (doc: Document, node: Node) => bounds(doc, doc.nodes.get(node.id) as Node)?.x;
const fill = (doc: Document, node: Node) =>
  (doc.nodes.get(node.id) as { appearance: { fills: { color: string }[] } }).appearance.fills[0]
    ?.color;

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { data?: unknown }).data;
  }
  throw new Error("did not throw");
};

const fixtures = import.meta.glob("../../../fixtures/documents/*.zibel.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("replaceFile", () => {
  it.each(Object.entries(fixtures).map(([path, text]) => [path.split("/").pop(), text]))(
    "changes nothing when an unedited export of %s comes back",
    (_name, text) => {
      const file = parseDocument(text as string);
      const doc: Document = {
        ...file,
        id: "DOC",
        version: 1,
        rev: 1,
        nodes: new Map(file.nodes.map((n) => [n.id, n])),
      };
      const e = exportNow(doc);
      expect(replace(doc, e.svg(), e)).toEqual({
        created: [],
        updated: [],
        deletedIds: [],
        skipped: [],
        warnings: [],
      });
    },
  );

  it("applies what the file changed and keeps what the Document changed since, per property", () => {
    const { doc, a, b, c } = setup();
    const e = exportNow(doc);
    since(doc, () => {
      set(doc, a, { x: 5 });
      set(doc, b, { name: "agent" });
    });
    const file = recolour(e.svg(), b.id, "#FF0000").replace(
      'inkscape:label="c"',
      'inkscape:label="file"',
    );
    const out = replace(doc, file, e);
    expect(out.updated.map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
    expect(x(doc, a)).toBe(5);
    expect(doc.nodes.get(b.id)).toMatchObject({ name: "agent", appearance: red });
    expect(doc.nodes.get(c.id)).toMatchObject({ name: "file" });
  });

  it("applies a fill rule the file changed", () => {
    const { doc, p } = setup();
    const e = exportNow(doc);
    const file = e.svg().replace(element(p.id), (el) => el.replace("/>", ' fill-rule="evenodd"/>'));
    expect(replace(doc, file, e).updated.map((n) => n.id)).toEqual([p.id]);
    expect(doc.nodes.get(p.id)).toMatchObject({ fillRule: "evenodd" });
  });

  it("lands a moved Node where the file says, not moved twice by a baked transform", () => {
    const { doc, a } = setup();
    set(doc, a, { transform: [1, 0, 0, 1, 5, 0] });
    const e = exportNow(doc);
    // The export keeps the move in the matrix; Inkscape bakes the designer's move on to 15 into x.
    const file = e
      .svg()
      .replace(element(a.id), (el) =>
        el.replace(/ x="0"/, ' x="15"').replace(/ transform="[^"]*"/, ""),
      );
    replace(doc, file, e);
    expect(doc.nodes.get(a.id)).toMatchObject({ x: 15, transform: [1, 0, 0, 1, 0, 0] });
  });

  it("merges one Node both sides edited: the Agent's move and the file's colour", () => {
    const { doc, a } = setup();
    set(doc, a, { transform: [1, 0, 0, 1, 5, 0] });
    const e = exportNow(doc);
    since(doc, () => set(doc, a, { transform: [1, 0, 0, 1, 12, 0] }));
    replace(doc, recolour(e.svg(), a.id, "#FF0000"), e);
    expect(x(doc, a)).toBe(12);
    expect(fill(doc, a)).toBe("#FF0000");
  });

  it("lets the file win a property both sides changed, keeps a Node deleted since deleted, and says so", () => {
    const { doc, a, b } = setup();
    const e = exportNow(doc);
    since(doc, () => {
      set(doc, a, { appearance: { fills: [{ type: "solid", color: "#00FF00" }], strokes: [] } });
      doc.nodes.delete(b.id);
    });
    const out = replace(doc, recolour(recolour(e.svg(), a.id, "#FF0000"), b.id, "#FF0000"), e);
    expect(fill(doc, a)).toBe("#FF0000");
    expect(doc.nodes.has(b.id)).toBe(false);
    expect(out.skipped).toEqual([b.id]);
    expect(out.warnings).toEqual([
      expect.objectContaining({ code: "DELETED_SINCE", nodeId: b.id }),
    ]);
  });

  it("deletes nothing the scoped export did not contain", () => {
    const { doc, layer, a, b, c } = setup();
    const byArtboard = exportNow(doc);
    let d: Node | undefined;
    since(doc, () => {
      [d] = createNodes(doc, [
        { type: "rect", parentId: layer, x: 500, y: 0, width: 5, height: 5 },
      ]).nodes;
    });
    const artboardId = doc.artboards[0]?.id ?? "";
    expect(replace(doc, byArtboard.svg({ artboardId }), byArtboard).deletedIds).toEqual([]);
    expect(doc.nodes.has(d?.id ?? "")).toBe(true);

    const byNodes = exportNow(doc);
    const out = replace(doc, remove(byNodes.svg({ nodeIds: [a.id] }), a.id), byNodes);
    // The Layer, written as the way to a, stays.
    expect(out.deletedIds).toEqual([a.id]);
    for (const id of [layer, b.id, c.id, d?.id ?? ""]) expect(doc.nodes.has(id)).toBe(true);
  });

  it("creates a Node the file added, after its siblings, and skips one under a Group deleted since", () => {
    const { doc, layer, group } = setup();
    const e = exportNow(doc);
    since(doc, () => {
      for (const n of [...doc.nodes.values()].filter((n) => n.parentId === group.id)) {
        doc.nodes.delete(n.id);
      }
      doc.nodes.delete(group.id);
    });
    const added = '<rect x="80" y="0" width="5" height="5"/>';
    const file = append(e.svg(), added).replace(
      new RegExp(`(<g id="z-${group.id}"[^>]*>)`),
      `$1${added}`,
    );
    const out = replace(doc, file, e);
    expect(out.created).toHaveLength(1);
    expect(out.created[0]).toMatchObject({ parentId: layer, x: 80 });
    expect(out.skipped).toHaveLength(1);
    expect(childrenOf(doc, layer).at(-1)?.id).toBe(out.created[0]?.id);
  });

  it("applies the file's stacking order, changing only the moved Node's index", () => {
    const { doc, layer, a } = setup();
    const e = exportNow(doc);
    const svg = e.svg();
    const aElement = element(a.id).exec(svg)?.[0] ?? "";
    // The file puts a on top: it is last in document order.
    const out = replace(doc, append(remove(svg, a.id), aElement), e);
    const order = childrenOf(doc, layer).map((n) => n.id);
    expect(order.at(-1)).toBe(a.id);
    expect(out.updated.map((n) => n.id)).toEqual([a.id]);
  });

  it("makes a Clipping Mask of a leaf clipped in Inkscape, whose Set Clip replaces the clip Node", () => {
    const { doc, layer, a, b } = setup();
    const e = exportNow(doc);
    // Set Clip with b over a: b moves into <defs> under a new id, and a carries the clip-path.
    const aElement = element(a.id).exec(e.svg())?.[0] ?? "";
    const file = remove(e.svg(), b.id)
      .replace(aElement, `<g id="g9" clip-path="url(#clipPath13)">${aElement}</g>`)
      .replace(
        "</sodipodi:namedview>",
        '</sodipodi:namedview><defs><clipPath clipPathUnits="userSpaceOnUse" id="clipPath13"><rect id="rect15" x="2" y="2" width="4" height="4"/></clipPath></defs>',
      );
    const out = replace(doc, file, e);
    expect(out.deletedIds).toEqual([b.id]);
    const group = out.created.find((n) => n.type === "group");
    expect(group).toMatchObject({ parentId: layer });
    expect(out.created.find((n) => n.type === "rect")).toMatchObject({
      parentId: group?.id,
      clipping: true,
      x: 2,
    });
    expect(doc.nodes.get(a.id)).toMatchObject({ parentId: group?.id });
  });

  it("releases a Clipping Mask released in Inkscape, the clip back above the Group", () => {
    const { doc, layer, a, b } = setup();
    const { group } = makeMask(doc, { clipNodeId: b.id, contentIds: [a.id] });
    const e = exportNow(doc);
    // What Inkscape 1.2.2's Release writes: the clip keeps its id and leaves the Group.
    const svg = e.svg();
    const inline = /<clipPath [^>]*>(<rect [^>]*\/>)<\/clipPath>/.exec(svg);
    const file = svg
      .replace(inline?.[0] ?? "", "")
      .replace(`clip-path="url(#clip-z-${group.id})"`, 'clip-path="none"')
      .replace(new RegExp(`(<g id="z-${group.id}"[^>]*>.*?</g>)`), `$1${inline?.[1]}`);
    const out = replace(doc, file, e);
    expect(out.updated.map((n) => n.id)).toContain(b.id);
    const clip = doc.nodes.get(b.id);
    expect(clip && "clipping" in clip).toBe(false);
    expect(clip).toMatchObject({ parentId: layer });
    expect(childrenOf(doc, group.id).map((n) => n.id)).toEqual([a.id]);
  });

  it("updates an Artboard the file resized", () => {
    const { doc } = setup();
    const e = exportNow(doc);
    const file = e.svg().replace(/(<inkscape:page [^>]*)width="200"/, '$1width="250"');
    expect(replace(doc, file, e).artboards?.[0]?.frame).toMatchObject({ width: 250 });
  });

  it("refuses a file that did not come from this Document, and a base rev the Document has not reached", () => {
    const { doc } = setup();
    const e = exportNow(doc);
    const other = setup("OTHER").doc;
    const foreign = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>';
    for (const text of [foreign, toSvg(other), serializeDocument(other)]) {
      expect(errorOf(() => replace(doc, text, e))).toMatchObject({
        code: "INVALID_DOCUMENT",
        path: "content",
        hint: expect.stringContaining("Open"),
      });
    }
    expect(errorOf(() => replace(doc, e.svg(), { ...e, baseRev: doc.rev + 1 }))).toMatchObject({
      code: "REV_CONFLICT",
      path: "baseRev",
    });
    expect(e.rebuild).not.toHaveBeenCalled();
  });

  it("merges without a base against the current Document, with a warning", () => {
    const { doc, b, c } = setup();
    const e = exportNow(doc);
    // A .zibel.json carries no rev, so without baseRev there is nothing to rebuild.
    const json = structuredClone(doc);
    set(json, b, { appearance: red });
    const out = replace(doc, serializeDocument(json), e);
    expect(e.rebuild).not.toHaveBeenCalled();
    expect(out.updated.map((n) => n.id)).toEqual([b.id]);
    expect(out.warnings).toEqual([expect.objectContaining({ code: "NO_BASE" })]);
    // An SVG whose base the Delta Log no longer reaches.
    const later = exportNow(doc).svg();
    const pruned = replace(doc, recolour(later, c.id, "#FF0000"), { rebuild: () => null });
    expect(pruned.warnings).toEqual([expect.objectContaining({ code: "NO_BASE" })]);
    expect(pruned.updated.map((n) => n.id)).toEqual([c.id]);
    expect([fill(doc, b), fill(doc, c)]).toEqual(["#FF0000", "#FF0000"]);
  });
});
