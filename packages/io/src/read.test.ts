import { type ImageNode, readImage, serializeDocument, ZibelError } from "@zibel/core";
import { describe, expect, it } from "vitest";
import { RED_2x2_PNG, WEBP_HEADER } from "../../../fixtures/images.ts";
import { MAX_DEPTH, parseFile, parseSvg, SVG_LIMIT } from "./index.ts";

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

it("reads <text> as one Point Type, its Inkscape lines joined by returns, keeping the font name", () => {
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
  const [plain, abc, centred, ...rest] = leaves(file);
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
  expect(plain).not.toHaveProperty("leading");
  expect(abc).toMatchObject({
    id: "01M38T29SBZ873XP2NBD2K6CYR",
    x: 10,
    y: 20,
    content: "a\nbc\n",
    fontFamily: "DejaVu Sans",
    fontSize: 11.906,
    appearance: { fills: [{ color: "#FF0000" }] },
  });
  // Half of "Hi"'s advances at 10 pt: (652 + 246) × 10 / 1000 / 2.
  expect(centred).toMatchObject({ x: 95.51, content: "Hi" });
  expect(file.warnings).toEqual([
    expect.objectContaining({ code: "FONT_MISSING", nodeId: abc?.id }),
  ]);
});

// Saved by Inkscape 1.2.2 (ADR-0022): line tspans, and flowed text with its positioned fallback
// lines, overflow included; the frames Inkscape keeps in <defs>.
const INKSCAPE_TEXT =
  '<defs><rect id="box" x="150" y="20" width="100" height="80" fill="none" /><rect id="b1" x="10" y="10" width="100" height="40" /><rect id="b2" x="10" y="60" width="50" height="100" /><rect id="b3" x="150" y="10" width="100" height="100" /></defs>' +
  '<text id="t1" x="20" y="40" font-family="Source Sans 3" font-size="12" style="font-kerning:none;line-height:1.2" xml:space="preserve"><tspan sodipodi:role="line" x="20" y="40" id="tspan2">First line</tspan><tspan sodipodi:role="line" x="20" y="54.4" id="tspan4" /><tspan sodipodi:role="line" x="20" y="68.8" id="tspan6">Third</tspan></text>' +
  '<text id="t2" font-family="Source Sans 3" font-size="12" style="shape-inside:url(#box);white-space:pre;line-height:1.2" xml:space="preserve"><tspan x="150" y="30.249774" id="tspan26">The quick brown </tspan><tspan x="150" y="44.649776" id="tspan28">fox jumps over the </tspan><tspan x="150" y="59.049777" id="tspan30">lazy dog again and </tspan><tspan x="150" y="73.449779" id="tspan32">again.\n</tspan><tspan x="150" y="87.84978" id="tspan34">New para</tspan></text>' +
  '<text id="over" font-family="Source Sans 3" font-size="12" style="shape-inside:url(#b1);white-space:pre;line-height:1.2" xml:space="preserve"><tspan x="10" y="20.249774" id="tspan35">one\n</tspan><tspan x="10" y="34.649776" id="tspan37">two\n</tspan><tspan x="10" y="60.249774" id="tspan41"><tspan dx="0 4.0559921 6.5280075 4.0439987 5.9520035 5.9520035" id="tspan39">three\n</tspan></tspan><tspan x="10" y="74.649775" id="tspan45"><tspan dx="0 3.3839951 6.5039978 6.5280075" id="tspan43">four</tspan></tspan></text>' +
  '<text id="long" font-family="Source Sans 3" font-size="12" style="shape-inside:url(#b2);white-space:pre;line-height:1.2" xml:space="preserve"><tspan x="10" y="170.24977" id="tspan49"><tspan dx="0 6.4080048 6.5280075 6.6600037 5.9520035 4.0439987 5.3519897 6.0479965 3.0599899 2.9520035 3.5039978 3.8759995 6.0479965 6.0479965 2.9520035 3.0599899 2.9520035 4.788002 4.0559921 2.9520035 5.4719925 2.4000092 8.5800018 6.5039978 4.0439987 6.6600037 2.4000092 2.4000092 4.0559921 8.5800018 6.5039978 2.4000092 2.4000092 2.4000092 5.0279999 6.4920044 6.0480042 5.2200012 5.9519958" id="tspan47">Supercalifragilistic word  two   spaces</tspan></tspan></text>' +
  '<text id="empty" font-family="Source Sans 3" font-size="12" style="shape-inside:url(#b3);white-space:pre;line-height:15px" xml:space="preserve"><tspan x="150" y="20.549774" id="tspan51">a\n</tspan><tspan x="150" y="35.549774" id="tspan53">\n</tspan><tspan x="150" y="50.549774" id="tspan55">b\n</tspan></text>' +
  '<text id="pt" x="20" y="180" font-family="Source Sans 3" font-size="12" style="line-height:15px" xml:space="preserve"><tspan sodipodi:role="line" x="20" y="180" id="tspan12">First</tspan><tspan sodipodi:role="line" x="20" y="182" id="tspan14">Second</tspan></text>';

it("reads Inkscape's multi-line and flowed text as one Text Node each", () => {
  const file = parseFile(svg('width="300" height="200" viewBox="0 0 300 200"', INKSCAPE_TEXT));
  const byName = Object.fromEntries(
    leaves(file).map((n) => [n.type === "text" ? n.content.slice(0, 7) : n.type, n]),
  );
  expect(leaves(file)).toHaveLength(6);
  expect(file.warnings).toEqual([]);
  expect(byName["First l"]).toMatchObject({
    kind: "point",
    x: 20,
    y: 40,
    content: "First line\n\nThird",
  });
  expect(byName["First l"]).not.toHaveProperty("leading");
  expect(byName["The qui"]).toMatchObject({
    kind: "area",
    x: 150,
    y: 20,
    width: 100,
    height: 80,
    content: "The quick brown fox jumps over the lazy dog again and again.\nNew para",
  });
  expect(byName["one\ntwo"]).toMatchObject({
    x: 10,
    y: 10,
    width: 100,
    height: 40,
    content: "one\ntwo\nthree\nfour",
  });
  expect(byName.Superca).toMatchObject({ content: "Supercalifragilistic word  two   spaces" });
  expect(byName["a\n\nb\n"]).toMatchObject({ kind: "area", leading: 15, content: "a\n\nb\n" });
  expect(byName["First\nS"]).toMatchObject({ kind: "point", x: 20, y: 180, leading: 15 });
});

it.each([
  ["1.25", 15],
  ["150%", 18],
  ["15px", 15],
  ["1.2", undefined],
  ["normal", undefined],
])("reads line-height %s as leading %s at 12 pt", (lineHeight, leading) => {
  const file = parseFile(
    svg(
      "",
      `<text x="0" y="10" font-size="12" style="line-height:${lineHeight}"><tspan sodipodi:role="line">a</tspan><tspan sodipodi:role="line">b</tspan></text>`,
    ),
  );
  expect((leaves(file)[0] as { leading?: number }).leading).toBe(leading);
});

it("scales Area Type's frame and leading with a baked scale", () => {
  const file = parseFile(
    svg(
      "",
      '<defs><rect id="f" x="10" y="10" width="100" height="40"/></defs>' +
        '<text transform="matrix(2 0 0 2 5 0)" font-size="12" style="shape-inside:url(#f);white-space:pre;line-height:15px">a</text>',
    ),
  );
  expect(leaves(file)[0]).toMatchObject({
    x: 25,
    y: 20,
    width: 200,
    height: 80,
    fontSize: 24,
    leading: 30,
  });
});

it("warns when Area Type cannot flow as written, and keeps its text", () => {
  const file = parseFile(
    svg(
      "",
      '<defs><circle id="c" cx="50" cy="50" r="40"/></defs>' +
        '<text font-size="12" style="shape-inside:url(#c);white-space:pre">in a circle</text>' +
        '<text x="5" y="5" font-size="12" style="shape-inside:url(#nope);white-space:pre">a\nb</text>' +
        '<text x="50" y="50" text-anchor="middle"><tspan sodipodi:role="line">a</tspan><tspan sodipodi:role="line">b</tspan></text>' +
        '<defs><rect id="r" width="50" height="50"/></defs>' +
        '<text style="shape-inside:url(#r);text-anchor:middle"><title>Note</title>centred</text>',
    ),
  );
  const [circle, missing, centred, area] = leaves(file);
  expect(area).toMatchObject({ kind: "area", x: 0, y: 0, content: "centred" });
  // Warnings come once per kind, so the centred Area Type is checked on its own.
  const alone = parseFile(
    svg(
      "",
      '<defs><rect id="r" width="50" height="50"/></defs><text style="shape-inside:url(#r);text-anchor:end">a</text>',
    ),
  );
  expect(alone.warnings).toEqual([expect.objectContaining({ code: "UNSUPPORTED_ATTRIBUTE" })]);
  expect(alone.warnings[0]?.message).toMatch(/^text-anchor/);
  expect(circle).toMatchObject({
    kind: "area",
    x: 10,
    y: 10,
    width: 80,
    height: 80,
    content: "in a circle",
  });
  expect(missing).toMatchObject({ kind: "point", x: 5, y: 5, content: "a\nb" });
  expect(centred).toMatchObject({ kind: "point", content: "a\nb" });
  expect(file.warnings.map((w) => [w.code, w.message.split(" ")[0]])).toEqual([
    ["UNSUPPORTED_ATTRIBUTE", "shape-inside"],
    ["UNSUPPORTED_ATTRIBUTE", "text-anchor"],
  ]);
});

it("keeps fill-rule on what becomes a Path, and drops it without a warning elsewhere", () => {
  const d = "M 0 0 L 9 0 L 9 9 Z M 3 3 L 6 3 L 6 6 Z";
  const file = parseFile(
    svg(
      'width="10" height="10"',
      `<path d="${d}" fill-rule="evenodd"/><path d="${d}" style="fill-rule:evenodd"/>` +
        '<g fill-rule="evenodd"><polygon points="0 0 9 0 9 9"/></g>' +
        `<g zibel:stack="true" style="fill-rule:evenodd"><path d="${d}" fill="#FF0000"/><path d="${d}" fill="#0000FF"/></g>` +
        `<path d="${d}"/><rect fill-rule="evenodd" width="1" height="1"/>` +
        // Zibel's own export of a two-Fill evenodd Path: the rule on each paint.
        `<g zibel:stack="true"><path d="${d}" fill-rule="evenodd" fill="#FF0000"/><path d="${d}" fill-rule="evenodd" fill="#0000FF"/></g>`,
    ),
  );
  expect(leaves(file).map((n) => [n.type, "fillRule" in n ? n.fillRule : undefined])).toEqual([
    ["path", "evenodd"],
    ["path", "evenodd"],
    ["path", "evenodd"],
    ["path", "evenodd"],
    ["path", "nonzero"],
    ["rect", undefined],
    ["path", "evenodd"],
  ]);
  expect(leaves(file)[3]).toMatchObject({ appearance: { fills: [{}, {}] } });
  expect(file.warnings).toEqual([]);
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
  // The clipped rect and its Clipping Path, in a Group of their own.
  expect(leaves(file).map((n) => n.type)).toEqual([
    "rect",
    "rect",
    "path",
    "path",
    "rect",
    "rect",
    "rect",
    "path",
  ]);
  expect(leaves(file)[1]).toMatchObject({ clipping: true });
  expect(leaves(file)[2]).toMatchObject({ d: "M 0 0 L 1 1" });
  const codes = file.warnings.map((w) => w.code);
  expect(codes.filter((c) => c === "UNSUPPORTED_ELEMENT")).toHaveLength(6);
  expect(new Set(codes)).toEqual(
    new Set([
      "UNSUPPORTED_ELEMENT",
      "UNSUPPORTED_ATTRIBUTE",
      "PATH_EFFECT_FLATTENED",
      "BOX3D_AS_PATHS",
      "UNSUPPORTED_PAINT",
      "DUPLICATE_ID",
      "INVALID_PATH",
      "INVALID_IMAGE",
    ]),
  );
  // mask, filter and marker-end; the clip-path is held.
  expect(codes.filter((c) => c === "UNSUPPORTED_ATTRIBUTE")).toHaveLength(3);
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

it("reads where a Zibel export came from: zibel:doc, zibel:rev and zibel:scope", () => {
  const origin = (attrs: string) => parseFile(svg(`viewBox="0 0 10 10" ${attrs}`)).origin;
  expect(origin('zibel:doc="D" zibel:rev="7" zibel:scope="doc"')).toEqual({ docId: "D", rev: 7 });
  // Each scope toSvg writes comes back: dialect.test.ts.
  // A rev that is not a whole number gives no base to merge from.
  expect(origin('zibel:doc="D" zibel:rev="x"')).toEqual({ docId: "D" });
  expect(origin("")).toBeUndefined();
});

describe("Clipping Masks (ADR-0021)", () => {
  const G = "z-01J00000000000000000000G01";
  const C = "z-01J00000000000000000000C01";
  const byId = (file: ReturnType<typeof parseFile>, xml: string) =>
    file.nodes.find((n) => `z-${n.id}` === xml);
  const children = (file: ReturnType<typeof parseFile>, id: string | undefined) =>
    file.nodes.filter((n) => n.parentId === id).sort((a, b) => (a.index < b.index ? -1 : 1));

  it("reads Inkscape's clipped Group, the clip in <defs> under a new id, as a Clipping Mask", () => {
    const file = parseFile(
      svg(
        'width="200" height="200" viewBox="0 0 200 200"',
        '<defs><clipPath clipPathUnits="userSpaceOnUse" id="clipPath13"><circle id="circle15" cx="80" cy="80" r="50" fill="#00ff00"/></clipPath></defs>' +
          `<g id="${G}" clip-path="url(#clipPath13)" transform="translate(10 0)"><rect width="100" height="100" fill="#FF0000"/></g>`,
      ),
    );
    expect(file.warnings).toEqual([]);
    const group = byId(file, G);
    const [rect, clip] = children(file, group?.id);
    expect(rect).toMatchObject({ type: "rect", x: 10 });
    // On top, in the Group's user space, its paint kept but not drawn.
    expect(clip).toMatchObject({
      type: "ellipse",
      x: 40,
      y: 30,
      width: 100,
      clipping: true,
      appearance: { fills: [{ color: "#00FF00" }] },
    });
  });

  it("reads Zibel's inline <clipPath> where it sits, with its id and clip-rule", () => {
    const file = parseFile(
      svg(
        "",
        `<g id="${G}" clip-path="url(#clip-${G})"><rect width="9" height="9"/>` +
          `<clipPath id="clip-${G}" clipPathUnits="userSpaceOnUse"><path id="${C}" d="M 0 0 L 9 0 L 9 9 Z" fill="none" clip-rule="evenodd"/></clipPath>` +
          '<rect x="5" width="9" height="9"/></g>',
      ),
    );
    const group = byId(file, G);
    expect(children(file, group?.id).map((n) => n.type)).toEqual(["rect", "path", "rect"]);
    expect(byId(file, C)).toMatchObject({
      clipping: true,
      fillRule: "evenodd",
      parentId: group?.id,
    });
  });

  it("wraps a clipped leaf in a new Group, the clip in the leaf's user space", () => {
    const file = parseFile(
      svg(
        "",
        '<defs><clipPath id="c"><rect x="1" y="1" width="2" height="2"/></clipPath></defs>' +
          '<rect id="z-01J00000000000000000000R01" transform="translate(10 20)" clip-path="url(#c)" width="5" height="5"/>',
      ),
    );
    const rect = byId(file, "z-01J00000000000000000000R01");
    const group = file.nodes.find((n) => n.id === rect?.parentId);
    expect(group).toMatchObject({ type: "group", name: "" });
    expect(children(file, group?.id)).toMatchObject([
      { type: "rect", x: 10, y: 20 },
      { type: "rect", x: 11, y: 21, width: 2, clipping: true },
    ]);
  });

  it("imports unclipped, warning once, a clip Zibel cannot hold", () => {
    const clip = (inner: string, attrs = "") =>
      parseFile(
        svg(
          "",
          `<defs><clipPath id="c" ${attrs}>${inner}</clipPath></defs><g clip-path="url(#c)"><rect width="5" height="5"/></g>`,
        ),
      );
    for (const file of [
      clip('<text x="0" y="5">Hi</text>'),
      clip('<rect width="1" height="1"/><rect width="2" height="2"/>'),
      clip('<g><rect width="1" height="1"/></g>'),
      clip('<rect width="1" height="1"/>', 'clipPathUnits="objectBoundingBox"'),
      clip('<rect width="1" height="1"/>', 'clip-path="url(#d)"'),
      parseFile(svg("", '<g clip-path="url(#nope)"><rect width="5" height="5"/></g>')),
      parseFile(
        svg(
          "",
          '<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g inkscape:groupmode="layer" clip-path="url(#c)"><rect width="5" height="5"/></g>',
        ),
      ),
    ]) {
      expect(file.warnings).toMatchObject([{ code: "UNSUPPORTED_ATTRIBUTE" }]);
      expect(file.nodes.some((n) => "clipping" in n)).toBe(false);
    }
  });

  it("takes clip-path none, as Inkscape's Release writes it, as no clip", () => {
    const file = parseFile(svg("", '<g clip-path="none"><rect width="5" height="5"/></g>'));
    expect(file.warnings).toEqual([]);
  });
});

describe("<image>", () => {
  const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
  const open = (body: string, known?: (url: string) => string | undefined) =>
    parseSvg(svg(`width="100" height="100" ${XLINK}`, body), undefined, { known });
  const images = (file: ReturnType<typeof parseSvg>) =>
    file.nodes.filter((n): n is ImageNode => n.type === "image");

  it("reads Inkscape's embedded image: its frame, preserveAspectRatio and file", () => {
    const file = open(
      `<image x="5" y="6" width="30" height="20" preserveAspectRatio="xMidYMid slice" xlink:href="${RED_2x2_PNG}"/>`,
    );
    const [image] = images(file);
    expect(image).toMatchObject({
      x: 5,
      y: 6,
      width: 30,
      height: 20,
      preserveAspectRatio: "xMidYMid slice",
      src: "pending:0",
    });
    expect(image).not.toHaveProperty("appearance");
    expect(file.images.get("pending:0")).toMatchObject({ mime: "image/png", width: 2, height: 2 });
    expect(file.warnings).toEqual([]);
  });

  it("reads SVG 2's href, takes a missing size from the file and SVG's own default alignment", () => {
    const [image] = images(open(`<image href="${RED_2x2_PNG}"/>`));
    expect(image).toMatchObject({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      preserveAspectRatio: "xMidYMid meet",
    });
  });

  it("drops defer, and bakes a move and uniform scale into the frame", () => {
    const [image] = images(
      open(
        `<image transform="translate(10 20) scale(2)" width="4" height="3" preserveAspectRatio="defer xMinYMin" href="${RED_2x2_PNG}"/>`,
      ),
    );
    expect(image).toMatchObject({
      x: 10,
      y: 20,
      width: 8,
      height: 6,
      preserveAspectRatio: "xMinYMin meet",
      transform: [1, 0, 0, 1, 0, 0],
    });
  });

  it("gives two copies of one file one key, and a known file its id", () => {
    const body = `<image href="${RED_2x2_PNG}"/><image x="5" href="${RED_2x2_PNG}"/>`;
    const file = open(body);
    expect(images(file).map((n) => n.src)).toEqual(["pending:0", "pending:0"]);
    expect([...file.images.keys()]).toEqual(["pending:0"]);
    const id = "a".repeat(64);
    const known = open(body, (url) => (url === RED_2x2_PNG ? id : undefined));
    expect(images(known).map((n) => n.src)).toEqual([id, id]);
    expect([...known.images.keys()]).toEqual([id]);
  });

  it.each([
    ["a linked file", '<image href="photo.png" width="1" height="1"/>', "LINKED_IMAGE_DROPPED"],
    ["a WebP", `<image href="${WEBP_HEADER}" width="1" height="1"/>`, "INVALID_IMAGE"],
  ])("drops %s with a warning", (_, body, code) => {
    const file = open(body);
    expect(images(file)).toEqual([]);
    expect(file.images.size).toBe(0);
    expect(file.warnings).toEqual([expect.objectContaining({ code })]);
  });

  it("makes an image clipped by Inkscape's Set Clip a Clipping Mask", () => {
    const file = open(
      `<defs><clipPath id="c"><rect x="1" y="1" width="2" height="2"/></clipPath></defs><image clip-path="url(#c)" width="4" height="4" href="${RED_2x2_PNG}"/>`,
    );
    const group = file.nodes.find((n) => n.type === "group");
    expect(file.nodes.filter((n) => n.parentId === group?.id).map((n) => n.type)).toEqual([
      "image",
      "rect",
    ]);
    expect(file.warnings).toEqual([]);
  });

  it("caps an SVG at 5 MB outside its embedded images", () => {
    const png = readImage(RED_2x2_PNG, "src").bytes;
    const big = new Uint8Array(4 * 1024 * 1024);
    big.set(png);
    const url = `data:image/png;base64,${big.toBase64()}`;
    expect(url.length).toBeGreaterThan(SVG_LIMIT);
    expect(
      parseFile(svg(XLINK, `<image width="1" height="1" xlink:href="${url}"/>`)).nodes,
    ).toContainEqual(expect.objectContaining({ type: "image" }));
    const markup = svg(
      XLINK,
      `<desc>${"x".repeat(SVG_LIMIT)}</desc><image href="${RED_2x2_PNG}"/>`,
    );
    expect(errorOf(() => parseFile(markup))).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});
