import { expect, it } from "vitest";
import { ZibelError } from "./errors.ts";
import { formatPath, normalizePath, parsePath, pathBounds, shapeSegments } from "./path.ts";
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
  // An ellipse starts at its top and runs in cubics.
  expect(
    formatPath(shapeSegments({ type: "ellipse", x: 10, y: 10, width: 80, height: 40 })),
  ).toMatch(/^M 50 10 C/);
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

it("bounds a path with more segments than a function call takes arguments", () => {
  const segments = Array.from({ length: 200_000 }, (_, i) => ({
    cmd: "L" as const,
    args: [i, -i],
  }));
  expect(pathBounds(segments)).toEqual({ x: 0, y: -199_999, width: 199_999, height: 199_999 });
});

it("normalises relative commands, H, V, S and T to absolute M, L, C, Q and Z", () => {
  expect(formatPath(normalizePath("m 10 10 h 20 v 20 s 5 5 10 0 t 10 0 z", "d"))).toBe(
    "M 10 10 L 30 10 L 30 30 C 30 30 35 35 40 30 Q 40 30 50 30 Z",
  );
  // S and T reflect the previous control point; implicit repeats continue the command.
  expect(
    formatPath(normalizePath("M0 0C0 10 10 10 10 0S20-10 20 0Q25 5 30 0T40 0l5 5 5 5", "d")),
  ).toBe("M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0 Q 25 5 30 0 Q 35 -5 40 0 L 45 5 L 50 10");
  // A command after Z without M starts a new subpath at the closed one's start.
  expect(formatPath(normalizePath("M 5 5 L 10 0 Z l 1 1", "d"))).toBe("M 5 5 L 10 0 Z M 5 5 L 6 6");
});

it("turns arcs into cubics on the ellipse", () => {
  const arc = normalizePath("M 0 0 A 10 10 0 0 1 20 0", "d");
  expect(arc.slice(1).every((s) => s.cmd === "C")).toBe(true);
  const b = pathBounds(arc) as Rect;
  for (const [k, v] of Object.entries({ x: 0, y: -10, width: 20, height: 10 })) {
    expect(b[k as keyof Rect]).toBeCloseTo(v, 3);
  }
  // Compact flags, a relative end point and the radius scaled up to reach it.
  const compact = normalizePath("M0 0a1 1 0 0110 0", "d");
  expect(compact.at(-1)?.args.slice(-2)).toEqual([10, 0]);
  expect((pathBounds(compact) as Rect).height).toBeCloseTo(5, 3);
  // A zero radius is a line; an arc to the current point draws nothing.
  expect(formatPath(normalizePath("M 0 0 A 0 5 0 0 0 10 0 A 5 5 0 0 0 10 0", "d"))).toBe(
    "M 0 0 L 10 0",
  );
});

it("refuses path data it cannot read", () => {
  for (const d of ["L 0 0", "M 0", "M 0 0 X 1", "M 0 0 A 1 1 0 2 0 5 5", ""]) {
    expect(errorOf(() => normalizePath(d, "d")).code).toBe("INVALID_PATH");
  }
});
