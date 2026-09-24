import { serializeDocument, ZibelError } from "@zibel/core";
import { expect, it } from "vitest";
import { parseFile, SVG_LIMIT } from "./index.ts";

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

const NS = [
  'xmlns="http://www.w3.org/2000/svg"',
  'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
  'xmlns:zibel="https://zibel.dev/ns/svg"',
].join(" ");
const svg = (attrs: string, body = "") => `<svg ${NS} ${attrs}>${body}</svg>`;

it("opens .zibel.json text as core reads it, detected by content", () => {
  const file = parseFile(
    `﻿  ${JSON.stringify({
      version: 1,
      name: "J",
      artboards: [{ id: "a", name: "A", frame: { x: 0, y: 0, width: 10, height: 10 } }],
      nodes: [
        {
          id: "l",
          type: "layer",
          name: "L",
          parentId: null,
          index: "a0",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          transform: [1, 0, 0, 1, 0, 0],
          tags: [],
          meta: {},
        },
      ],
    })}`,
  );
  expect(file).toMatchObject({ name: "J", warnings: [] });
  expect(file.nodes.map((n) => n.id)).toEqual(["l"]);
});

it.each([
  ["hello", "not an SVG or .zibel.json file"],
  ["<svg><g></svg>", "mismatch"],
  ["<html/>", "<svg>"],
  [`<!DOCTYPE svg [<!ENTITY xxe "BOOM">]>${svg("", "<text>&xxe;</text>")}`, "entity"],
])("refuses %j as INVALID_DOCUMENT", (content, message) => {
  expect(errorOf(() => parseFile(content))).toMatchObject({
    code: "INVALID_DOCUMENT",
    path: "content",
    message: expect.stringContaining(message),
  });
});

it("refuses an SVG over 5 MB before parsing it", () => {
  const big = svg("", `<desc>${"x".repeat(SVG_LIMIT)}</desc>`);
  expect(errorOf(() => parseFile(big))).toMatchObject({ code: "LIMIT_EXCEEDED", path: "content" });
});

it("makes one Artboard from the root's size in pt, and one empty Layer", () => {
  const file = parseFile(svg('width="210mm" height="297mm" viewBox="0 0 210 297"'));
  expect(file.name).toBe("Untitled");
  expect(file.artboards).toEqual([
    {
      id: expect.any(String),
      name: "Artboard 1",
      frame: { x: 0, y: 0, width: 595.276, height: 841.89 },
    },
  ]);
  expect(file.nodes).toMatchObject([{ type: "layer", name: "Layer 1", parentId: null }]);
  // A px or unitless length is one pt, as Illustrator opens it.
  const px = parseFile(svg('width="300px" height="200"', "<title>T</title>"));
  expect(px.name).toBe("T");
  expect(px.artboards[0]?.frame).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  expect(parseFile(svg('viewBox="10 20 30 40"')).artboards[0]?.frame).toEqual({
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  expect(parseFile(svg('width="10in" height="1in"'), { name: "Hint" }).name).toBe("Hint");
});

it("never runs or keeps a script or an event attribute", () => {
  const file = parseFile(
    svg('width="10" height="10" onload="alert(1)"', "<script>alert(2)</script>"),
  );
  expect(
    serializeDocument({
      id: "",
      version: 1,
      rev: 0,
      ...file,
      nodes: new Map(file.nodes.map((n) => [n.id, n])),
    }),
  ).not.toMatch(/alert/);
});
