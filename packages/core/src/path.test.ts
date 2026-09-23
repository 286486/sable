import { expect, it } from "vitest";
import { ZibelError } from "./errors.ts";
import { formatPath, parsePath, pathBounds, shapeSegments } from "./path.ts";
import type { Rect, Shape } from "./schema.ts";

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZibelError) return e.data;
    throw e;
  }
  throw new Error("expected a ZibelError");
};

it("parses absolute M, L, C, Q and Z", () => {
  expect(parsePath("M 10 10 L 60 10 C 70 10 70 40 60 40 Q 35 50 10 40 Z", "d")).toEqual([
    { cmd: "M", args: [10, 10] },
    { cmd: "L", args: [60, 10] },
    { cmd: "C", args: [70, 10, 70, 40, 60, 40] },
    { cmd: "Q", args: [35, 50, 10, 40] },
    { cmd: "Z", args: [] },
  ]);
});

it("accepts implicit repeats, commas and compact numbers", () => {
  expect(parsePath("M0,0 1,2L3 4 5-6e1", "d")).toEqual([
    { cmd: "M", args: [0, 0] },
    { cmd: "L", args: [1, 2] },
    { cmd: "L", args: [3, 4] },
    { cmd: "L", args: [5, -60] },
  ]);
});

it("bounds a cubic by its extremum, not its control points", () => {
  expect(pathBounds(parsePath("M 0 0 C 0 100 100 100 100 0", "d"))).toEqual({
    x: 0,
    y: 0,
    width: 100,
    height: 75,
  });
  expect(pathBounds(parsePath("M 0 0 Q 50 100 100 0", "d"))).toEqual({
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  });
});

it("formats with at most 3 decimals", () => {
  expect(formatPath(parsePath("M 0.00001 -0.0001 L 10.00049 1.23456 Z", "d"))).toBe(
    "M 0 0 L 10 1.235 Z",
  );
});

it.each([
  ["M 0 0 l 10 10", /absolute/],
  ["M 0 0 H 10", /H/],
  ["M 0 0 A 5 5 0 0 1 10 10", /A/],
  ["M 0 0 L 10", /L/],
  ["M 0 0 L 10 x", /x/],
  ["L 10 10", /M/],
  ["", /M/],
  ["M 0 0 L 1e400 0", /range/],
])("rejects %j with INVALID_PATH", (d, hint) => {
  const error = errorOf(() => parsePath(d, "nodes[0].d"));
  expect(error).toMatchObject({ code: "INVALID_PATH", path: "nodes[0].d" });
  expect(`${error.message} ${error.hint}`).toMatch(hint);
});

it("derives d for each Live Shape, with bounds equal to the shape's box", () => {
  const cases: [Shape, string | null, Rect][] = [
    [
      { type: "rect", x: 10, y: 20, width: 50, height: 30, radius: 0 },
      "M 10 20 L 60 20 L 60 50 L 10 50 Z",
      { x: 10, y: 20, width: 50, height: 30 },
    ],
    [
      { type: "rect", x: 0, y: 0, width: 40, height: 20, radius: 100 },
      null,
      { x: 0, y: 0, width: 40, height: 20 },
    ],
    [
      { type: "ellipse", x: 10, y: 10, width: 80, height: 40 },
      null,
      { x: 10, y: 10, width: 80, height: 40 },
    ],
    [
      { type: "line", x1: 0, y1: 5, x2: 30, y2: 45 },
      "M 0 5 L 30 45",
      { x: 0, y: 5, width: 30, height: 40 },
    ],
    [
      { type: "polygon", cx: 50, cy: 50, radius: 10, sides: 4 },
      "M 50 40 L 60 50 L 50 60 L 40 50 Z",
      { x: 40, y: 40, width: 20, height: 20 },
    ],
    [
      { type: "star", cx: 0, cy: 0, outerRadius: 10, innerRadius: 5, points: 4 },
      null,
      { x: -10, y: -10, width: 20, height: 20 },
    ],
  ];
  for (const [shape, d, box] of cases) {
    const segments = shapeSegments(shape);
    if (d) expect(formatPath(segments)).toBe(d);
    const b = pathBounds(segments);
    for (const k of ["x", "y", "width", "height"] as const) expect(b?.[k]).toBeCloseTo(box[k], 9);
  }
});

it("clamps the corner radius and draws four arcs", () => {
  const d = formatPath(
    shapeSegments({ type: "rect", x: 0, y: 0, width: 40, height: 20, radius: 100 }),
  );
  expect(d.match(/C/g)).toHaveLength(4);
  expect(d.startsWith("M 10 0 L 30 0 C")).toBe(true);
});

it("gives a 5-point star 10 vertices, alternating outer and inner, first at the top", () => {
  const segments = shapeSegments({
    type: "star",
    cx: 0,
    cy: 0,
    outerRadius: 10,
    innerRadius: 4,
    points: 5,
  });
  const vertices = segments.filter((s) => s.cmd !== "Z");
  expect(vertices).toHaveLength(10);
  expect(vertices[0]?.args[0]).toBeCloseTo(0, 9);
  expect(vertices[0]?.args[1]).toBeCloseTo(-10, 9);
  expect(vertices.map((v) => Math.round(Math.hypot(v.args[0] ?? 0, v.args[1] ?? 0)))).toEqual([
    10, 4, 10, 4, 10, 4, 10, 4, 10, 4,
  ]);
  expect(segments.at(-1)?.cmd).toBe("Z");
});
