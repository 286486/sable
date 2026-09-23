import { expect, it } from "vitest";
import { applyTo, compose, round, scaleOf, transformSegments } from "./matrix.ts";

const p = { x: 35, y: 25 };

it("rotates clockwise (y down) about the pivot, without -0 or float noise", () => {
  expect(round(compose({ rotate: 90 }, p))).toEqual([0, 1, -1, 0, 60, -10]);
  expect(applyTo(compose({ rotate: 90 }, p), 35, 25)).toEqual([35, 25]);
  // Clockwise on screen: the point right of the pivot moves below it.
  const [x, y] = applyTo(compose({ rotate: 90 }, p), 45, 25);
  expect([x, y].map((n) => Math.round(n))).toEqual([35, 35]);
});

it("scales about the pivot, uniformly or per axis", () => {
  expect(applyTo(compose({ scale: 2 }, p), 35, 25)).toEqual([35, 25]);
  expect(compose({ scale: 2 }, p)).toEqual([2, 0, 0, 2, -35, -25]);
  expect(compose({ scale: { x: 2, y: 1 } }, p)).toEqual([2, 0, 0, 1, -35, 0]);
});

it("skews in degrees like SVG skewX and skewY", () => {
  expect(round(compose({ skew: { x: 45 } }, { x: 0, y: 0 }))).toEqual([1, 0, 1, 1, 0, 0]);
  expect(round(compose({ skew: { y: 45 } }, { x: 0, y: 0 }))).toEqual([1, 1, 0, 1, 0, 0]);
});

it("applies a matrix about the pivot, so [-1 0 0 1 0 0] reflects across it", () => {
  expect(compose({ matrix: [-1, 0, 0, 1, 0, 0] }, p)).toEqual([-1, 0, 0, 1, 70, 0]);
});

it("translates independently of the pivot, after scale, skew and rotate", () => {
  expect(compose({ translate: { x: 10, y: 5 } }, p)).toEqual([1, 0, 0, 1, 10, 5]);
  expect(applyTo(compose({ scale: 2, translate: { x: 10 } }, p), 35, 25)).toEqual([45, 25]);
  // Scale, then rotate: a point 10 right of the pivot ends 20 below it.
  const [x, y] = applyTo(compose({ scale: 2, rotate: 90 }, p), 45, 25);
  expect([x, y].map((n) => Math.round(n))).toEqual([35, 45]);
});

it("maps every point of M, L, C and Q and leaves Z alone", () => {
  const m = [1, 0, 0, 1, 10, 20] as const;
  expect(
    transformSegments(
      [
        { cmd: "M", args: [0, 0] },
        { cmd: "L", args: [1, 2] },
        { cmd: "C", args: [1, 1, 2, 2, 3, 3] },
        { cmd: "Q", args: [4, 4, 5, 5] },
        { cmd: "Z", args: [] },
      ],
      [...m],
    ),
  ).toEqual([
    { cmd: "M", args: [10, 20] },
    { cmd: "L", args: [11, 22] },
    { cmd: "C", args: [11, 21, 12, 22, 13, 23] },
    { cmd: "Q", args: [14, 24, 15, 25] },
    { cmd: "Z", args: [] },
  ]);
});

it("measures the scale factor as sqrt|det|", () => {
  expect(scaleOf([2, 0, 0, 3, 9, 9])).toBeCloseTo(Math.sqrt(6), 12);
  expect(scaleOf([-1, 0, 0, 1, 0, 0])).toBe(1);
});
