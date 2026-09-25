import type { Segment } from "./path.ts";
import type { Matrix } from "./schema.ts";

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m · n`: apply `n` first, then `m`. */
export function multiply([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix {
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

export const applyTo = ([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] => [
  a * x + c * y + e,
  b * x + d * y + f,
];

/** Affine maps keep Bézier control polygons, so mapping every point transforms the curve exactly. */
export function transformSegments(segments: Segment[], m: Matrix): Segment[] {
  return segments.map(({ cmd, args }) => ({
    cmd,
    args: args.flatMap((_, k) => (k % 2 ? [] : applyTo(m, args[k] ?? 0, args[k + 1] ?? 0))),
  }));
}

export interface TransformParts {
  translate?: { x?: number; y?: number };
  /** Degrees, clockwise on screen (y down). */
  rotate?: number;
  scale?: number | { x: number; y: number };
  /** Degrees, as SVG skewX and skewY. */
  skew?: { x?: number; y?: number };
  /** Replaces rotate, skew and scale. */
  matrix?: Matrix;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const move = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/** `translate · P · (matrix | rotate · skew · scale) · P⁻¹`: scale, skew, rotate about the pivot, then move. */
export function compose(t: TransformParts, pivot: { x: number; y: number }): Matrix {
  let m = t.matrix ?? IDENTITY;
  if (!t.matrix) {
    const s =
      typeof t.scale === "number" ? { x: t.scale, y: t.scale } : (t.scale ?? { x: 1, y: 1 });
    const cos = Math.cos(rad(t.rotate ?? 0));
    const sin = Math.sin(rad(t.rotate ?? 0));
    const skew: Matrix = [1, Math.tan(rad(t.skew?.y ?? 0)), Math.tan(rad(t.skew?.x ?? 0)), 1, 0, 0];
    m = multiply(multiply([cos, sin, -sin, cos, 0, 0], skew), [s.x, 0, 0, s.y, 0, 0]);
  }
  const about = multiply(multiply(move(pivot.x, pivot.y), m), move(-pivot.x, -pivot.y));
  return multiply(move(t.translate?.x ?? 0, t.translate?.y ?? 0), about);
}

/** The area scale factor's square root: exact for uniform scale, the geometric mean otherwise. */
export const scaleOf = ([a, b, c, d]: Matrix) => Math.sqrt(Math.abs(a * d - b * c));

/** 6 decimals and no -0, so stored matrices read cleanly (a 90° turn is `[0, 1, -1, 0, …]`). */
export const round = (m: Matrix) => m.map((n) => Math.round(n * 1e6) / 1e6 || 0) as Matrix;

/** The inverse of an invertible matrix. */
export function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
