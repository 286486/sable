import { createDocument, createNodes, type ShapeNode, shapeSegments } from "@zibel/core";
import { expect, it } from "vitest";
import { type Canvas2D, drawDocument } from "./canvas.ts";

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
