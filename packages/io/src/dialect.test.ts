import { type Document, parseDocument, serializeDocument } from "@zibel/core";
import { expect, it } from "vitest";
import { parseSvg } from "./svg.ts";
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
