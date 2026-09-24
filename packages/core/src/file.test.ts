import { describe, expect, it } from "vitest";
import { createDocument, createNodes } from "./document.ts";
import { ZibelError } from "./errors.ts";
import { type Migration, parseDocument, serializeDocument } from "./file.ts";
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

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

it("parses what it serialises back to the same Document, and the same text", () => {
  const doc = scene();
  const text = serializeDocument(doc);
  const parsed = parseDocument(text);
  expect(parsed.name).toBe("Doc");
  expect(parsed.artboards).toEqual(doc.artboards);
  expect(new Map(parsed.nodes.map((n) => [n.id, n]))).toEqual(doc.nodes);
  const reopened: Document = {
    ...doc,
    id: "other",
    rev: 1,
    nodes: new Map(parsed.nodes.map((n) => [n.id, n])),
  };
  expect(serializeDocument(reopened)).toBe(text);
});

describe("migrations", () => {
  // A test migration: version 1 called the name `title`.
  const up: Migration = ({ title, ...rest }) => ({ ...rest, name: title });
  const v1 = (() => {
    const { name, ...rest } = JSON.parse(serializeDocument(scene()));
    return { ...rest, title: name };
  })();
  const text = (file: object) => JSON.stringify(file);

  it("runs the up migration of an older version before validating", () => {
    expect(parseDocument(text(v1), [up]).name).toBe("Doc");
    expect(errorOf(() => parseDocument(text(v1)))).toMatchObject({ code: "INVALID_DOCUMENT" });
  });

  it("does not migrate a file already at the current version", () => {
    const { title, ...rest } = v1;
    const current = { ...rest, version: 2, name: title };
    const never: Migration = () => {
      throw new Error("ran");
    };
    expect(parseDocument(text(current), [never]).name).toBe("Doc");
  });

  it.each([
    [3, [up]],
    [2, []],
  ])("refuses version %s, newer than this build, with no downgrade", (version, migrations) => {
    expect(errorOf(() => parseDocument(text({ ...v1, version }), migrations))).toMatchObject({
      code: "INVALID_DOCUMENT",
      path: "version",
      hint: expect.stringMatching(/newer/),
    });
  });

  it.each([0, 1.5, "1"])("refuses version %j", (version) => {
    expect(errorOf(() => parseDocument(text({ ...v1, version }), [up]))).toMatchObject({
      code: "INVALID_DOCUMENT",
      path: "version",
    });
  });
});

describe("validation", () => {
  const good = () => JSON.parse(serializeDocument(scene()));
  type File = ReturnType<typeof good>;
  type N = Record<string, unknown> & { id: string; type: string; parentId: string | null };
  const byType = (f: File, type: string): N => f.nodes.find((n: N) => n.type === type);
  const at = (f: File, n: N) => f.nodes.indexOf(n);

  it.each<[string, (f: File) => string | File, string, (f: File) => string]>([
    ["text that is not JSON", () => "{", "INVALID_DOCUMENT", () => "content"],
    ["an array", () => "[]", "INVALID_DOCUMENT", () => "content"],
    ["an unknown top-level key", (f) => ({ ...f, foo: 1 }), "INVALID_DOCUMENT", () => "foo"],
    [
      "an unknown Node key",
      (f) => {
        byType(f, "rect").foo = 1;
        return f;
      },
      "INVALID_DOCUMENT",
      (f) => `nodes[${at(f, byType(f, "rect"))}].foo`,
    ],
    [
      "a rect at the root",
      (f) => {
        byType(f, "rect").parentId = null;
        return f;
      },
      "INVALID_PARENT",
      (f) => `nodes[${at(f, byType(f, "rect"))}].parentId`,
    ],
    [
      "a parentId naming no Node",
      (f) => {
        byType(f, "rect").parentId = "nope";
        return f;
      },
      "INVALID_DOCUMENT",
      (f) => `nodes[${at(f, byType(f, "rect"))}].parentId`,
    ],
    [
      "a parentId naming an Artboard",
      (f) => {
        byType(f, "rect").parentId = f.artboards[0].id;
        return f;
      },
      "INVALID_PARENT",
      (f) => `nodes[${at(f, byType(f, "rect"))}].parentId`,
    ],
    [
      "a Group whose parent chain is a cycle",
      (f) => {
        const group = byType(f, "group");
        const other = { ...group, id: "0", parentId: group.id, index: "a0" };
        group.parentId = other.id;
        f.nodes.unshift(other);
        return f;
      },
      "INVALID_PARENT",
      () => "nodes[0].parentId",
    ],
    [
      "a duplicate id",
      (f) => ({ ...f, nodes: [...f.nodes, f.nodes[0]] }),
      "INVALID_DOCUMENT",
      (f) => `nodes[${f.nodes.length}].id`,
    ],
    [
      "a duplicate Artboard id",
      (f) => ({ ...f, artboards: [f.artboards[0], f.artboards[0]] }),
      "INVALID_DOCUMENT",
      () => "artboards[1].id",
    ],
    [
      "an index that is no fractional-index key",
      (f) => {
        byType(f, "rect").index = "!";
        return f;
      },
      "INVALID_DOCUMENT",
      (f) => `nodes[${at(f, byType(f, "rect"))}].index`,
    ],
    [
      "two siblings with one index",
      (f) => {
        byType(f, "path").index = byType(f, "group").index;
        return f;
      },
      "INVALID_DOCUMENT",
      (f) => `nodes[${Math.max(at(f, byType(f, "path")), at(f, byType(f, "group")))}].index`,
    ],
    [
      "a named colour",
      (f) => {
        (byType(f, "rect").appearance as { fills: { color: string }[] }).fills[0] = {
          type: "solid",
          color: "red",
        } as never;
        return f;
      },
      "INVALID_COLOR",
      (f) => `nodes[${at(f, byType(f, "rect"))}].appearance.fills[0].color`,
    ],
    [
      "relative path data",
      (f) => {
        byType(f, "path").d = "h 1";
        return f;
      },
      "INVALID_PATH",
      (f) => `nodes[${at(f, byType(f, "path"))}].d`,
    ],
    ["no Artboard", (f) => ({ ...f, artboards: [] }), "INVALID_DOCUMENT", () => "artboards"],
    [
      "a named Artboard background",
      (f) => {
        f.artboards[0].background = "white";
        return f;
      },
      "INVALID_COLOR",
      () => "artboards[0].background",
    ],
  ])("rejects %s", (_, change, code, path) => {
    const file = good();
    const changed = change(file);
    const content = typeof changed === "string" ? changed : JSON.stringify(changed);
    expect(errorOf(() => parseDocument(content))).toMatchObject({
      code,
      path: path(file),
      hint: expect.stringMatching(/\S/),
    });
  });
});
