import { expect, it } from "vitest";
import { ZibelError } from "./errors.ts";
import { formatPath, parsePath, pathBounds } from "./path.ts";

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
