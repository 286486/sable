import {
  createDocument,
  createNodes,
  type Document,
  parseDocument,
  type RenderScope,
  serializeDocument,
} from "@zibel/core";
import { expect, it } from "vitest";
import {
  alpha,
  idOf,
  paintAttrs,
  scopeAttr,
  scopeOf,
  starAttrs,
  starOf,
  withAlpha,
  xmlId,
} from "./dialect.ts";
import { normalise } from "./index.ts";
import { parseSvg } from "./read.ts";
import { toSvg } from "./write.ts";

const fixtures = import.meta.glob("../../../fixtures/documents/*.zibel.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

const open = (text: string): Document => {
  const file = parseDocument(text);
  return {
    ...file,
    id: "DOC",
    version: 1,
    rev: 1,
    nodes: new Map(file.nodes.map((n) => [n.id, n])),
  };
};

it.each(Object.entries(fixtures).map(([path, text]) => [path.split("/").pop(), path, text]))(
  "writes %s and reads it back as the same Document",
  async (_name, path, text) => {
    const doc = open(text);
    const svg = toSvg(doc);
    // The export, byte for byte: a change to the dialect shows here first (vitest -u to accept).
    await expect(svg).toMatchFileSnapshot(path.replace(/\.zibel\.json$/, ".svg"));
    const read = parseSvg(svg);
    expect(read.warnings).toEqual([]);
    expect(read.origin).toEqual({ docId: "DOC", rev: 1 });
    const back = {
      ...doc,
      name: read.name,
      artboards: read.artboards,
      nodes: new Map(read.nodes.map((n) => [n.id, n])),
    };
    expect(serializeDocument(back)).toBe(serializeDocument(doc));
  },
);

it("reads back every Render Scope, id and alpha byte it writes", () => {
  const scopes: RenderScope[] = [
    { artboardId: "01M38T29S8GTJN2S1004N4Q1BH" },
    { nodeIds: ["01M38T29S8GTJN2S1004N4Q1BH", "01M38T29S9V6NZ3YY4ARKXBP1G"] },
    { rect: { x: -1.5, y: 2, width: 300.125, height: 0.001 } },
  ];
  for (const scope of scopes) expect(scopeOf(scopeAttr(scope))).toEqual(scope);
  expect(scopeAttr()).toBe("doc");
  expect(scopeOf("doc")).toBeUndefined();
  expect(idOf(xmlId("01M38T29S8GTJN2S1004N4Q1BH"))).toBe("01M38T29S8GTJN2S1004N4Q1BH");
  expect(idOf("path123")).toBeUndefined();
  for (let byte = 0; byte < 256; byte++) {
    const color = `#12AB9F${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    const paint = paintAttrs("fill", color);
    const back = withAlpha(paint.fill as string, alpha(paint["fill-opacity"]));
    expect(back).toBe(byte === 255 ? "#12AB9F" : color);
  }
});

it("reads back a polygon's and a star's parameters, unturned and untwisted", () => {
  const { doc, defaultLayerId: parentId } = createDocument({ id: "d", name: "Doc", artboards: [] });
  const [polygon, star] = createNodes(doc, [
    { type: "polygon", parentId, cx: 0, cy: 0, radius: 30, sides: 6 },
    { type: "star", parentId, cx: 0, cy: 0, outerRadius: 35, innerRadius: 15, points: 5 },
  ]).nodes;
  if (polygon?.type !== "polygon" || star?.type !== "star") throw new Error("setup");
  expect(starOf(starAttrs(polygon))).toEqual({
    shape: { type: "polygon", radius: 30, sides: 6 },
    turn: 0,
    twisted: false,
  });
  expect(starOf(starAttrs(star))).toEqual({
    shape: { type: "star", outerRadius: 35, innerRadius: 15, points: 5 },
    turn: 0,
    twisted: false,
  });
  expect(starOf({ ...starAttrs(star), arg2: 0 }).twisted).toBe(true);
});

it("names the scope a file was exported from in its origin", () => {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "DOC",
    name: "Doc",
    artboards: [{ width: 100, height: 100 }],
  });
  const [rect] = createNodes(doc, [
    { type: "rect", parentId, x: 0, y: 0, width: 10, height: 10 },
  ]).nodes;
  const artboardId = doc.artboards[0]?.id ?? "";
  for (const scope of [
    { artboardId },
    { nodeIds: [rect?.id ?? ""] },
    { rect: { x: 1, y: 2, width: 3, height: 4 } },
  ] satisfies RenderScope[]) {
    expect(parseSvg(toSvg(doc, undefined, { scope })).origin).toEqual({
      docId: "DOC",
      rev: doc.rev,
      scope,
    });
  }
});

it("normalises a Document as a file of its scope would carry it, keeping the listed ids it still has", () => {
  const { doc, defaultLayerId: parentId } = createDocument({
    id: "DOC",
    name: "Doc",
    artboards: [{ width: 100, height: 100 }],
  });
  const [moved, kept] = createNodes(doc, [
    { type: "rect", parentId, x: 0, y: 0, width: 10.00049, height: 10 },
    { type: "ellipse", parentId, x: 50, y: 50, width: 20, height: 20 },
  ]).nodes;
  if (!moved || !kept) throw new Error("setup");
  // A move is baked into x and y on import, as Inkscape's optimised transforms do.
  moved.transform = [1, 0, 0, 1, 5, 7];
  const all = normalise(doc, undefined);
  expect(all.nodes.get(moved.id)).toMatchObject({
    x: 5,
    y: 7,
    width: 10,
    transform: [1, 0, 0, 1, 0, 0],
  });
  expect(all.nodes.size).toBe(doc.nodes.size);
  const one = normalise(doc, { nodeIds: [kept.id, "01M38T29S8GTJN2S1004N4Q1BH"] });
  expect([...one.nodes.values()].filter((n) => n.type !== "layer").map((n) => n.id)).toEqual([
    kept.id,
  ]);
  expect(normalise(doc, { nodeIds: ["01M38T29S8GTJN2S1004N4Q1BH"] }).nodes.size).toBe(0);
});
