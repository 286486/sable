import { serializeDocument, ZibelError } from "@zibel/core";
import { expect, it } from "vitest";
import { MAX_DEPTH, parseFile, SVG_LIMIT } from "./index.ts";

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

it("reads Inkscape layers, labels, locks and pages, and Zibel's tags, meta, stacks and backgrounds", () => {
  const kept = "01M38T29S8GTJN2S1004N4Q1BH";
  const file = parseFile(
    svg(
      'width="100mm" height="50mm" viewBox="0 0 100 50" sodipodi:docname="two pages.svg"',
      '<sodipodi:namedview inkscape:document-units="mm">' +
        `<inkscape:page x="0" y="0" width="100" height="50" id="z-${kept}" inkscape:label="Front"/>` +
        '<inkscape:page x="110" y="0" width="20" height="20" id="page2"/></sodipodi:namedview>' +
        `<rect width="100" height="50" fill="#FFF4D6" zibel:artboard="${kept}" sodipodi:insensitive="true"/>` +
        '<rect width="100" height="50" fill="#FFF4D6" zibel:artboard="01M38T29S9V6NZ3YY4ARKXBP1G"/>' +
        '<rect width="100" height="50" fill="#000000" zibel:background="true"/>' +
        '<g inkscape:groupmode="layer" inkscape:label="Top" transform="translate(5,5)" sodipodi:insensitive="1" style="display:none">' +
        '<g inkscape:groupmode="layer" inkscape:label="Inner"><path d="M 0 0 L 1 0"/></g>' +
        `<g zibel:stack="true" zibel:tags='["a"]' zibel:meta='{"k":1}' inkscape:label="Stack" style="opacity:0.5">` +
        '<path d="M 0 0 L 1 1" fill="#FF0000"/><path d="M 0 0 L 1 1" fill="#00FF00"/>' +
        '<path d="M 0 0 L 1 1" fill="none" stroke="#0000FF"/></g></g>',
    ),
  );
  expect(file.name).toBe("two pages");
  expect(file.artboards).toEqual([
    {
      id: kept,
      name: "Front",
      frame: { x: 0, y: 0, width: 283.465, height: 141.732 },
      background: "#FFF4D6",
    },
    {
      id: expect.not.stringMatching(/page2/),
      name: "Artboard 2",
      frame: { x: 311.811, y: 0, width: 56.693, height: 56.693 },
    },
  ]);
  expect(file.nodes.filter((n) => n.type === "rect")).toEqual([]);
  const [top, ...others] = byParent(file, null);
  expect(others).toEqual([]);
  expect(top).toMatchObject({ type: "layer", name: "Top", visible: false, locked: true });
  const [inner, stack] = byParent(file, top?.id ?? "");
  expect(inner).toMatchObject({ type: "layer", name: "Inner", visible: true, locked: false });
  expect(byParent(file, inner?.id ?? "")[0]).toMatchObject({
    d: "M 14.173 14.173 L 17.008 14.173",
  });
  expect(stack).toMatchObject({
    type: "path",
    name: "Stack",
    opacity: 0.5,
    tags: ["a"],
    meta: { k: 1 },
    d: "M 14.173 14.173 L 17.008 17.008",
    appearance: {
      fills: [{ color: "#FF0000" }, { color: "#00FF00" }],
      strokes: [{ color: "#0000FF", width: 2.835 }],
    },
  });
});

it("warns about tags or meta that are not JSON, and drops them", () => {
  const file = parseFile(
    svg("", `<rect width="1" height="1" zibel:tags="nope" zibel:meta='[1]'/>`),
  );
  expect(leaves(file)[0]).toMatchObject({ tags: [], meta: {} });
  expect(file.warnings.map((w) => w.code)).toEqual(["INVALID_TAGS_META"]);
});

const star = (attrs: Record<string, string | number>) =>
  `<path ${Object.entries({
    "sodipodi:type": "star",
    "sodipodi:sides": 5,
    "sodipodi:cx": 260,
    "sodipodi:cy": 150,
    "sodipodi:r1": 35,
    "sodipodi:r2": 15,
    "sodipodi:arg1": -Math.PI / 2,
    "sodipodi:arg2": -Math.PI / 2 + Math.PI / 5,
    "inkscape:flatsided": "false",
    "inkscape:rounded": 0,
    "inkscape:randomized": 0,
    d: "M 260 115 L 270 140 L 250 140 Z",
    ...attrs,
  })
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ")}/>`;

it("reads Inkscape stars and polygons back as Live Shapes, a turned one with its matrix", () => {
  const file = parseFile(
    svg(
      'width="400" height="300"',
      star({}) +
        star({
          "inkscape:flatsided": "true",
          "sodipodi:sides": 6,
          "sodipodi:r1": 30,
          "sodipodi:r2": 25.981,
        }) +
        star({ "sodipodi:arg1": 0, "sodipodi:arg2": Math.PI / 5 }),
    ),
  );
  const [five, six, turned] = leaves(file);
  expect(five).toMatchObject({
    type: "star",
    cx: 260,
    cy: 150,
    outerRadius: 35,
    innerRadius: 15,
    points: 5,
    transform: [1, 0, 0, 1, 0, 0],
  });
  expect(six).toMatchObject({ type: "polygon", cx: 260, cy: 150, radius: 30, sides: 6 });
  expect(turned).toMatchObject({
    type: "star",
    cx: 260,
    cy: 150,
    transform: [0, 1, -1, 0, 410, -110],
  });
  expect(file.warnings).toEqual([]);
});

it("imports what a Live Shape cannot hold yet as a Path, with a warning", () => {
  const file = parseFile(
    svg(
      'width="400" height="300"',
      star({ "inkscape:rounded": 0.2 }) +
        star({ "sodipodi:arg2": -Math.PI / 2 + Math.PI / 5 + 0.1 }) +
        '<path sodipodi:type="arc" sodipodi:cx="5" sodipodi:cy="5" sodipodi:rx="5" sodipodi:ry="5" sodipodi:start="0" sodipodi:end="3" sodipodi:arc-type="slice" d="M 10 5 A 5 5 0 0 1 0 5 L 5 5 Z"/>',
    ),
  );
  expect(leaves(file).map((n) => n.type)).toEqual(["path", "path", "path"]);
  expect(leaves(file)[0]).toMatchObject({ d: "M 260 115 L 270 140 L 250 140 Z" });
  expect(file.warnings.map((w) => w.code)).toEqual(["STAR_AS_PATH", "ARC_AS_PATH"]);
});

it("reads a star with missing parameters as its Path", () => {
  const file = parseFile(svg("", star({ "sodipodi:r2": "x" })));
  expect(leaves(file)[0]?.type).toBe("path");
});

it("reads <text> as Point Type, one Node per Inkscape line, keeping the font name", () => {
  const file = parseFile(
    svg(
      'width="300" height="300"',
      '<text x="20" y="195" font-family="Source Sans 3" font-size="14" style="font-kerning:none" xml:space="preserve">Round &amp;  trip</text>' +
        `<text id="z-01M38T29SBZ873XP2NBD2K6CYR" style="font-size:4.2mm;font-family:'DejaVu Sans', sans-serif;fill:#ff0000">` +
        '<tspan sodipodi:role="line" x="10" y="20">  a\n</tspan>' +
        '<tspan sodipodi:role="line" x="10" y="30">b<tspan style="font-weight:bold">c</tspan></tspan>' +
        '<tspan sodipodi:role="line" x="10" y="40"/></text>' +
        '<text x="100" y="10" text-anchor="middle" font-size="10">Hi</text>' +
        '<text x="0" y="0">   </text>',
    ),
  );
  const [plain, a, bc, centred, ...rest] = leaves(file);
  expect(rest).toEqual([]);
  expect(plain).toMatchObject({
    type: "text",
    kind: "point",
    x: 20,
    y: 195,
    content: "Round &  trip",
    fontFamily: "Source Sans 3",
    fontSize: 14,
    appearance: { fills: [{ color: "#000000" }], strokes: [] },
  });
  expect(a).toMatchObject({
    id: "01M38T29SBZ873XP2NBD2K6CYR",
    x: 10,
    y: 20,
    content: "a",
    fontFamily: "DejaVu Sans",
    fontSize: 11.906,
    appearance: { fills: [{ color: "#FF0000" }] },
  });
  expect(bc).toMatchObject({ x: 10, y: 30, content: "bc", fontFamily: "DejaVu Sans" });
  expect(bc?.id).not.toBe(a?.id);
  // Half of "Hi"'s advances at 10 pt: (652 + 246) × 10 / 1000 / 2.
  expect(centred).toMatchObject({ x: 95.51, content: "Hi" });
  expect(file.warnings).toEqual([expect.objectContaining({ code: "FONT_MISSING", nodeId: a?.id })]);
});

it("opens a file with content Zibel cannot hold, with one warning per kind", () => {
  const id = "z-01M38T29SBZ873XP2NBD2K6CYR";
  const file = parseFile(
    svg(
      'width="100" height="100" xmlns:xlink="http://www.w3.org/1999/xlink"',
      '<defs><symbol id="s"><rect width="1" height="1"/></symbol><filter id="f"/><clipPath id="c"><rect width="5" height="5"/></clipPath>' +
        '<pattern id="p" width="2" height="2"/></defs>' +
        '<use xlink:href="#s"/><use href="#s"/><image href="data:image/png;base64,AAAA" width="1" height="1"/>' +
        "<flowRoot><flowPara>x</flowPara></flowRoot><foreignObject><div/></foreignObject>" +
        "<script>alert(1)</script><svg/><foo/>" +
        '<rect clip-path="url(#c)" mask="url(#m)" style="filter:url(#f)" width="2" height="2"/>' +
        '<path inkscape:path-effect="#e" inkscape:original-d="M 0 0 L 9 9" d="M 0 0 L 1 1"/>' +
        '<g sodipodi:type="inkscape:box3d"><path sodipodi:type="inkscape:box3dside" d="M 0 0 L 2 0 L 2 2 Z"/></g>' +
        '<rect fill="url(#p)" width="1" height="1"/>' +
        `<rect id="${id}" width="1" height="1"/><rect id="${id}" width="1" height="1"/>` +
        '<path d="M 0 0 L 1 1 M 0 1 L 1 0 Z" fill-rule="evenodd" marker-end="url(#m)"/>' +
        '<path d="M 0 0 X"/>',
    ),
  );
  expect(leaves(file).map((n) => n.type)).toEqual([
    "rect",
    "path",
    "path",
    "rect",
    "rect",
    "rect",
    "path",
  ]);
  expect(leaves(file)[1]).toMatchObject({ d: "M 0 0 L 1 1" });
  const codes = file.warnings.map((w) => w.code);
  expect(codes.filter((c) => c === "UNSUPPORTED_ELEMENT")).toHaveLength(7);
  expect(new Set(codes)).toEqual(
    new Set([
      "UNSUPPORTED_ELEMENT",
      "UNSUPPORTED_ATTRIBUTE",
      "PATH_EFFECT_FLATTENED",
      "BOX3D_AS_PATHS",
      "UNSUPPORTED_PAINT",
      "DUPLICATE_ID",
      "INVALID_PATH",
    ]),
  );
  expect(codes.filter((c) => c === "UNSUPPORTED_ATTRIBUTE")).toHaveLength(5);
  for (const w of file.warnings) expect(w.message).not.toBe("");
});

it("refuses Groups nested deeper than MAX_DEPTH with LIMIT_EXCEEDED", () => {
  const deep = (n: number) =>
    svg("", `${"<g>".repeat(n)}<rect width="1" height="1"/>${"</g>".repeat(n)}`);
  expect(leaves(parseFile(deep(MAX_DEPTH - 1)))).toHaveLength(1);
  expect(errorOf(() => parseFile(deep(5000)))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    path: "content",
  });
});

it("warns about clipping, masks and filters on a Group too", () => {
  const file = parseFile(
    svg(
      "",
      '<g clip-path="url(#c)" mask="url(#m)" filter="url(#f)"><rect width="1" height="1"/></g>',
    ),
  );
  expect(file.warnings.map((w) => w.code)).toEqual([
    "UNSUPPORTED_ATTRIBUTE",
    "UNSUPPORTED_ATTRIBUTE",
    "UNSUPPORTED_ATTRIBUTE",
  ]);
});

it("ignores an unreadable transform and drops an element scaled to nothing", () => {
  const file = parseFile(
    svg(
      "",
      '<rect transform="matrix(1 0 0)" x="2" width="1" height="1"/><rect transform="scale(0)" width="1" height="1"/>',
    ),
  );
  expect(leaves(file)).toMatchObject([{ x: 2, transform: [1, 0, 0, 1, 0, 0] }]);
  expect(file.warnings.map((w) => w.code)).toEqual(["INVALID_TRANSFORM", "INVALID_TRANSFORM"]);
});
