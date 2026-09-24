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

/** The Nodes of a file by parent, each as the fields a test names. */
const byParent = (file: ReturnType<typeof parseFile>, parentId: string | null) =>
  file.nodes.filter((n) => n.parentId === parentId).sort((a, b) => (a.index < b.index ? -1 : 1));

it("reads every shape element into a Live Shape or Path, in one Layer, in document order", () => {
  const file = parseFile(
    svg(
      'width="100" height="100" viewBox="0 0 100 100"',
      '<rect id="path123" x="1" y="2" width="3" height="4" rx="1"/>' +
        '<g transform="translate(10,20)"><circle cx="5" cy="5" r="5"/>' +
        '<path d="m 0 0 l 10 0 a 5 5 0 0 1 -10 0 z" transform="rotate(90)"/></g>' +
        '<polygon points="0,0 10,0 5,8"/><polyline points="0 0 5 5"/>' +
        '<line x1="0" y1="0" x2="3" y2="4"/><ellipse cx="50" cy="50" rx="10" ry="5"/>' +
        '<rect id="z-01M38T29SBZ873XP2NBD2K6CYR" x="0" y="0" width="10" height="10"/>',
    ),
  );
  const [layer, ...rest] = byParent(file, null);
  expect(rest).toEqual([]);
  expect(layer).toMatchObject({ type: "layer", name: "Layer 1" });
  const kids = byParent(file, layer?.id ?? "");
  expect(kids.map((n) => [n.type, n.index])).toEqual([
    ["rect", "a0"],
    ["group", "a1"],
    ["path", "a2"],
    ["path", "a3"],
    ["line", "a4"],
    ["ellipse", "a5"],
    ["rect", "a6"],
  ]);
  const [rect, group, polygon, polyline, line, ellipse, kept] = kids;
  expect(rect?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(rect).toMatchObject({ x: 1, y: 2, width: 3, height: 4, radius: 1 });
  expect(kept?.id).toBe("01M38T29SBZ873XP2NBD2K6CYR");
  expect(polygon).toMatchObject({ d: "M 0 0 L 10 0 L 5 8 Z" });
  expect(polyline).toMatchObject({ d: "M 0 0 L 5 5" });
  expect(line).toMatchObject({ x1: 0, y1: 0, x2: 3, y2: 4 });
  expect(ellipse).toMatchObject({ x: 40, y: 45, width: 20, height: 10 });
  // A move bakes into the parameters; a turn stays a matrix, the Group's included (ADR-0007).
  const [circle, turned] = byParent(file, group?.id ?? "");
  expect(group?.transform).toEqual([1, 0, 0, 1, 0, 0]);
  expect(circle).toMatchObject({
    type: "ellipse",
    x: 10,
    y: 20,
    width: 10,
    height: 10,
    transform: [1, 0, 0, 1, 0, 0],
  });
  expect(turned?.transform).toEqual([0, 1, -1, 0, 10, 20]);
  expect(turned?.type === "path" && turned.d).toMatch(/^M 0 0 L 10 0( C [-\d. ]+)+ Z$/);
});

it("scales user units to pt into the parameters, and keeps a skew as a matrix", () => {
  const file = parseFile(
    svg(
      'width="200" height="200" viewBox="0 0 100 100"',
      '<rect x="1" y="2" width="3" height="4" rx="1"/>' +
        '<rect x="1" y="2" width="3" height="4" transform="skewX(45)"/>' +
        '<g transform="matrix(1 0 0 1 5 0) scale(2)"><line x1="0" y1="0" x2="1" y2="1"/></g>',
    ),
  );
  const [layer] = byParent(file, null);
  const [scaled, skewed, group] = byParent(file, layer?.id ?? "");
  expect(scaled).toMatchObject({ x: 2, y: 4, width: 6, height: 8, radius: 2 });
  expect(skewed).toMatchObject({ x: 1, y: 2, width: 3, height: 4, transform: [2, 0, 2, 2, 0, 0] });
  expect(byParent(file, group?.id ?? "")[0]).toMatchObject({ x1: 10, y1: 0, x2: 14, y2: 4 });
});

it("gives a second element with the same z- id a new id", () => {
  const id = "z-01M38T29SBZ873XP2NBD2K6CYR";
  const file = parseFile(
    svg("", `<rect id="${id}" width="1" height="1"/><rect id="${id}" width="1" height="1"/>`),
  );
  const ids = file.nodes.filter((n) => n.type === "rect").map((n) => n.id);
  expect(ids[0]).toBe(id.slice(2));
  expect(ids[1]).not.toBe(id.slice(2));
});

/** The leaves of a file, in document order. */
const leaves = (file: ReturnType<typeof parseFile>) =>
  file.nodes.filter((n) => n.type !== "layer" && n.type !== "group");

it("resolves presentation attributes, <style> classes, style and inheritance into Appearance", () => {
  const file = parseFile(
    svg(
      'width="100" height="100"',
      "<style>/* c */ .a{fill:rgb(255,0,0);stroke:#00f} rect.b, .c{fill:#111}</style>" +
        '<rect class="a" fill="blue" style="stroke:yellow" width="1" height="1"/>' +
        '<g fill="green" fill-opacity=".5" color="#0f0"><path d="M 0 0 L 1 1"/>' +
        '<rect fill="currentColor" width="1" height="1"/></g>' +
        '<rect style="fill:none;stroke:#000;stroke-width:1mm;stroke-linejoin:round;display:none;opacity:.6;mix-blend-mode:multiply" width="1" height="1"/>' +
        '<rect stroke="#000" stroke-opacity="50%" stroke-dasharray="1,2,3" stroke-linecap="round" width="1" height="1"/>' +
        '<defs><linearGradient id="g" href="#h"/><linearGradient id="h"><stop offset="0" style="stop-color:#123456;stop-opacity:1"/></linearGradient></defs>' +
        '<rect fill="url(#g)" width="1" height="1"/><rect fill="url(#nope)" stroke="none" width="1" height="1"/>',
    ),
  );
  const [classed, inGroup, current, styled, stroked, gradient, missing] = leaves(file);
  const look = (n: (typeof file.nodes)[number] | undefined) =>
    n && "appearance" in n ? n.appearance : undefined;
  expect(look(classed)).toMatchObject({
    fills: [{ color: "#FF0000" }],
    strokes: [{ color: "#FFFF00", width: 1, cap: "butt", join: "miter", miterLimit: 4, dash: [] }],
  });
  expect(look(inGroup)).toEqual({ fills: [{ type: "solid", color: "#00800080" }], strokes: [] });
  expect(look(current)?.fills).toEqual([{ type: "solid", color: "#00FF0080" }]);
  expect(styled).toMatchObject({ visible: false, opacity: 0.6, blendMode: "multiply" });
  expect(look(styled)).toMatchObject({
    fills: [],
    strokes: [{ width: 2.835, join: "round", miterLimit: 10 }],
  });
  expect(look(stroked)?.strokes).toEqual([
    {
      color: "#00000080",
      width: 1,
      cap: "round",
      join: "miter",
      miterLimit: 4,
      dash: [1, 2, 3, 1, 2, 3],
    },
  ]);
  expect(look(gradient)?.fills).toEqual([{ type: "solid", color: "#123456" }]);
  expect(look(missing)).toEqual({ fills: [], strokes: [] });
  expect(file.warnings.map((w) => w.code).sort()).toEqual([
    "GRADIENT_FLATTENED",
    "UNSUPPORTED_PAINT",
  ]);
});

it("scales Stroke widths and dashes with the user unit", () => {
  const file = parseFile(
    svg(
      'width="20mm" height="10mm" viewBox="0 0 20 10"',
      '<line x2="10" stroke="#000" stroke-width=".5" stroke-dasharray="2 1"/>',
    ),
  );
  expect(leaves(file)[0]).toMatchObject({
    x2: 28.346,
    appearance: { strokes: [{ width: 1.417, dash: [5.669, 2.835] }] },
  });
});
