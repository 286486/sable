import { createDocument, createNodes, makeMask, type ShapeNode, shapeSegments } from "@zibel/core";
import { expect, it } from "vitest";
import { type Canvas2D, drawDocument, imagePlacement } from "./canvas.ts";

/** A context that logs every call and property write, with save/restore of its state. */
function recorder() {
  const log: string[] = [];
  const stack: Record<string, unknown>[] = [];
  let state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(
    {},
    {
      get: (_, k: string) =>
        k in state
          ? state[k]
          : (...args: unknown[]) => {
              if (k === "save") stack.push({ ...state });
              if (k === "restore") state = stack.pop() ?? state;
              log.push([k, ...args].join(" "));
            },
      set: (_, k: string, v) => {
        state[k] = v;
        log.push(`${k}=${v}`);
        return true;
      },
    },
  ) as Canvas2D;
  return { ctx, log };
}

const PATH_OPS = /^(moveTo|lineTo|bezierCurveTo|quadraticCurveTo|closePath)/;
const OP = { M: "moveTo", L: "lineTo", C: "bezierCurveTo", Q: "quadraticCurveTo", Z: "closePath" };
const traced = (n: ShapeNode) => shapeSegments(n).map((s) => [OP[s.cmd], ...s.args].join(" "));

const newDoc = () =>
  createDocument({
    id: "d",
    name: "Doc",
    artboards: [{ width: 200, height: 100, background: "#FFFFFF" }],
  });

it("fills the Artboard background, then traces a rect once and paints its Fill below its Stroke", () => {
  const { doc, defaultLayerId } = newDoc();
  createNodes(doc, [
    {
      type: "rect",
      parentId: defaultLayerId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#000000", width: 2 }] },
    },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  const body = log.filter((l) => !/^(save|restore|globalAlpha|transform)/.test(l));
  expect(body).toEqual([
    "fillStyle=#FFFFFF",
    "fillRect 0 0 200 100",
    "beginPath",
    "moveTo 10 10",
    "lineTo 60 10",
    "lineTo 60 40",
    "lineTo 10 40",
    "closePath",
    "fillStyle=#FF0000",
    "fill",
    "strokeStyle=#000000",
    "lineWidth=2",
    "lineCap=butt",
    "lineJoin=miter",
    "miterLimit=10",
    "setLineDash ",
    "stroke",
  ]);
});

it("traces every node type with the segments node_get reports, in stacking order", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const { nodes } = createNodes(doc, [
    {
      type: "group",
      parentId,
      children: [
        { type: "rect", x: 0, y: 0, width: 10, height: 10, radius: 2 },
        { type: "group", children: [{ type: "line", x1: 0, y1: 0, x2: 5, y2: 5 }] },
      ],
    },
    { type: "ellipse", parentId, x: 0, y: 0, width: 20, height: 10 },
    { type: "polygon", parentId, cx: 50, cy: 50, radius: 10, sides: 5 },
    { type: "star", parentId, cx: 80, cy: 50, outerRadius: 10, innerRadius: 4, points: 5 },
    { type: "path", parentId, d: "M 0 0 Q 10 20 20 0 Z" },
    { type: "layer" },
  ]);
  const leaves = nodes.filter((n): n is ShapeNode => "appearance" in n);
  expect(leaves).toHaveLength(6);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  expect(log.filter((l) => PATH_OPS.test(l))).toEqual(leaves.flatMap(traced));
});

it("skips hidden Nodes, and applies opacity and transform through save and restore", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [hidden, faded, after] = createNodes(doc, [
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
    { type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 },
  ]).nodes as [ShapeNode, ShapeNode, ShapeNode];
  hidden.visible = false;
  faded.opacity = 0.5;
  faded.transform = [0, 1, -1, 0, 60, -10];
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  expect(log.filter((l) => l === "beginPath")).toHaveLength(2);
  const alphas = log.filter((l) => l.startsWith("globalAlpha="));
  // Layer 1, faded rect, then the last rect back at full opacity.
  expect(alphas).toEqual(["globalAlpha=1", "globalAlpha=0.5", "globalAlpha=1"]);
  expect(log).toContain("transform 0 1 -1 0 60 -10");
  expect(after.visible).toBe(true);
});

it("draws Point Type with fillText per Fill and strokeText per Stroke, unkerned", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    {
      type: "text",
      parentId,
      x: 10,
      y: 50,
      content: "Hi",
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#0000FF", width: 2 }] },
    },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  const body = log.filter((l) => !/^(save|restore|globalAlpha|transform)/.test(l));
  expect(body).toEqual([
    "fillStyle=#FFFFFF",
    "fillRect 0 0 200 100",
    'font=12px "Source Sans 3"',
    "fontKerning=none",
    "fillStyle=#FF0000",
    "fillText Hi 10 50",
    "strokeStyle=#0000FF",
    "lineWidth=2",
    "lineCap=butt",
    "lineJoin=miter",
    "miterLimit=10",
    "setLineDash ",
    "strokeText Hi 10 50",
  ]);
});

it("draws each line of Point Type, one leading apart", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    {
      type: "text",
      parentId,
      x: 10,
      y: 50,
      content: "Hi\nHo",
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#0000FF", width: 2 }] },
    },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  expect(log.filter((l) => /^(fill|stroke)Text/.test(l))).toEqual([
    "fillText Hi 10 50",
    "fillText Ho 10 64.4",
    "strokeText Hi 10 50",
    "strokeText Ho 10 64.4",
  ]);
});

it("draws only the lines of Area Type that fit its frame", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    {
      type: "text",
      kind: "area",
      parentId,
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      content: "one\ntwo\nthree\nfour",
    },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  const drawn = log.filter((l) => l.startsWith("fillText")).map((l) => l.split(" "));
  expect(drawn.map(([, text, x]) => [text, x])).toEqual([
    ["one\n", "10"],
    ["two\n", "10"],
  ]);
  expect(drawn.map(([, , , y]) => Number(y) - 20)).toEqual([
    expect.closeTo(10.249774, 5),
    expect.closeTo(24.649774, 5),
  ]);
});

it("draws a font Zibel does not bundle in Source Sans 3, as render does", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  createNodes(doc, [
    { type: "text", parentId, x: 10, y: 50, content: "Hi", fontFamily: "Helvetica" },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  expect(log).toContain('font=12px "Source Sans 3"');
});

it("fills a Path with its fill rule", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const d = "M 0 0 L 30 0 L 30 30 Z M 10 5 L 20 5 L 20 15 Z";
  createNodes(doc, [
    {
      type: "path",
      parentId,
      d,
      fillRule: "evenodd",
      appearance: { fills: [{ color: "#000000" }] },
    },
    { type: "path", parentId, d, appearance: { fills: [{ color: "#000000" }] } },
  ]);
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  expect(log.filter((l) => l.startsWith("fill ") || l === "fill")).toEqual([
    "fill evenodd",
    "fill",
  ]);
});

it("clips a Clipping Mask's children by its Clipping Path, in document coordinates, and never paints it", () => {
  const { doc, defaultLayerId: parentId } = newDoc();
  const [content, clip] = createNodes(doc, [
    {
      type: "rect",
      parentId,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      appearance: { fills: [{ color: "#FF0000" }] },
    },
    { type: "path", parentId, d: "M 0 0 L 10 0 L 10 10 Z", fillRule: "evenodd" },
  ]).nodes as [ShapeNode, ShapeNode];
  makeMask(doc, { clipNodeId: clip.id, contentIds: [content.id] });
  doc.nodes.set(clip.id, {
    ...(doc.nodes.get(clip.id) as ShapeNode),
    transform: [1, 0, 0, 1, 5, 0],
  });
  const { ctx, log } = recorder();
  drawDocument(ctx, doc);
  const body = log.filter(
    (l) => !/^(save|restore|globalAlpha|transform|fillStyle=#FFFFFF|fillRect)/.test(l),
  );
  expect(body).toEqual([
    "beginPath",
    "moveTo 5 0",
    "lineTo 15 0",
    "lineTo 15 10",
    "closePath",
    "clip evenodd",
    "beginPath",
    ...traced(content),
    "fillStyle=#FF0000",
    "fill",
  ]);
});

it.each([
  ["none", { x: 10, y: 10, width: 60, height: 40 }],
  ["xMidYMid meet", { x: 10, y: 20, width: 60, height: 20 }],
  ["xMaxYMin meet", { x: 10, y: 10, width: 60, height: 20 }],
  ["xMinYMax slice", { x: 10, y: 10, width: 120, height: 40 }],
  ["xMidYMid slice", { x: -20, y: 10, width: 120, height: 40 }],
])("places a 30 × 10 file in a 60 × 40 frame at (10, 10) under %s", (par, rect) => {
  expect(
    imagePlacement({ x: 10, y: 10, width: 60, height: 40 }, { width: 30, height: 10 }, par),
  ).toEqual(rect);
});

it("draws an Image once its file is decoded, clipped to its frame under slice", () => {
  const { doc, defaultLayerId } = newDoc();
  const src = "a".repeat(64);
  doc.images.set(src, { mime: "image/png", width: 30, height: 10 });
  const image = {
    type: "image",
    parentId: defaultLayerId,
    src,
    x: 10,
    y: 10,
    width: 60,
    height: 40,
  } as const;
  createNodes(doc, [image, { ...image, preserveAspectRatio: "xMidYMid slice" }]);
  const drawn = (images?: Parameters<typeof drawDocument>[2]) => {
    const { ctx, log } = recorder();
    drawDocument(ctx, doc, images);
    return log.filter((l) => /^(drawImage|rect|clip)/.test(l));
  };
  expect(drawn()).toEqual([]);
  expect(drawn((id) => (id === src ? { image: "IMG", width: 30, height: 10 } : undefined))).toEqual(
    ["drawImage IMG 10 10 60 40", "rect 10 10 60 40", "clip", "drawImage IMG -20 10 120 40"],
  );
});
