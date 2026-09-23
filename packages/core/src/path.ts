import { ZibelError } from "./errors.ts";
import type { Rect, Shape } from "./schema.ts";

/** One absolute path command with its numbers, e.g. `{cmd: "C", args: [x1, y1, x2, y2, x, y]}`. */
export interface Segment {
  cmd: "M" | "L" | "C" | "Q" | "Z";
  args: number[];
}

const ARITY = { M: 2, L: 2, C: 6, Q: 4, Z: 0 } as const;
const TOKEN = /[\s,]*([A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;

/** Parses SVG `d` limited to absolute M, L, C, Q and Z (REQUIREMENTS §6.5). */
export function parsePath(d: string, path: string): Segment[] {
  const fail = (message: string, hint: string): never => {
    throw new ZibelError({ code: "INVALID_PATH", message, hint, path });
  };
  const tokens: string[] = [];
  let end = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(d); m; m = TOKEN.exec(d)) {
    tokens.push(m[1] as string);
    end = TOKEN.lastIndex;
  }
  const rest = d.slice(end).trim();
  if (rest) fail(`Unexpected "${rest.slice(0, 10)}" in d.`, "d holds commands and numbers only.");

  const segments: Segment[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++] as string;
    if (!/^[A-Za-z]$/.test(cmd)) fail(`Number ${cmd} has no command.`, "Start d with M x y.");
    if (!(cmd in ARITY)) {
      fail(
        `Command "${cmd}" is not supported.`,
        cmd === cmd.toLowerCase()
          ? "Use absolute (uppercase) commands M, L, C, Q and Z, in document coordinates."
          : "Only M, L, C, Q and Z are supported: write H, V as L, S as C, T as Q, and A as C.",
      );
    }
    const c = cmd as Segment["cmd"];
    if (segments.length === 0 && c !== "M") fail(`d starts with ${c}.`, "Start d with M x y.");
    const args: number[] = [];
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i] as string)) {
      const n = Number(tokens[i++]);
      if (!Number.isFinite(n)) fail(`${tokens[i - 1]} is out of range.`, "Use finite numbers.");
      args.push(n);
    }
    const n = ARITY[c];
    if (n === 0 ? args.length > 0 : args.length === 0 || args.length % n !== 0) {
      fail(
        `${c} takes ${n} numbers per segment; got ${args.length}.`,
        "M and L take x y; Q takes x1 y1 x y; C takes x1 y1 x2 y2 x y; Z takes none.",
      );
    }
    if (n === 0) segments.push({ cmd: c, args });
    for (let k = 0; k < args.length; k += n) {
      // After M, extra pairs are implicit L (SVG rule).
      segments.push({ cmd: k > 0 && c === "M" ? "L" : c, args: args.slice(k, k + n) });
    }
  }
  if (segments.length === 0) fail("d is empty.", "Start d with M x y.");
  return segments;
}

/** `d` with at most 3 decimals (REQUIREMENTS §6.5). */
export function formatPath(segments: Segment[]): string {
  const num = (n: number) => String(Math.round(n * 1000) / 1000 || 0);
  return segments.map((s) => [s.cmd, ...s.args.map(num)].join(" ")).join(" ");
}

/** Exact bounds of the curves (extrema, not control points), or null for no segments. */
export function pathBounds(segments: Segment[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const addX = (x: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  };
  const addY = (y: number) => {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  let cur = [0, 0];
  let start = [0, 0];
  for (const { cmd, args } of segments) {
    if (cmd === "Z") {
      cur = start;
      continue;
    }
    const end = args.slice(-2);
    const [x0 = 0, y0 = 0] = cur;
    const [x = 0, y = 0] = end;
    addX(x);
    addY(y);
    if (cmd === "C" || cmd === "Q") {
      const px = [x0, ...args.filter((_, k) => k % 2 === 0)];
      const py = [y0, ...args.filter((_, k) => k % 2 === 1)];
      for (const t of extrema(px)) addX(bezier(px, t));
      for (const t of extrema(py)) addY(bezier(py, t));
    }
    if (cmd === "M") start = end;
    cur = end;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Parameters in (0, 1) where a quadratic (3 points) or cubic (4 points) Bézier is flat on this axis. */
function extrema(p: number[]): number[] {
  const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = p;
  let roots: number[];
  if (p.length === 3) {
    const den = p0 - 2 * p1 + p2;
    roots = den === 0 ? [] : [(p0 - p1) / den];
  } else {
    // B'(t) / 3 = a t² + b t + c
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) roots = b === 0 ? [] : [-c / b];
    else {
      const disc = b * b - 4 * a * c;
      roots = disc < 0 ? [] : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function bezier(p: number[], t: number): number {
  const u = 1 - t;
  const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = p;
  return p.length === 3
    ? u * u * p0 + 2 * u * t * p1 + t * t * p2
    : u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** 4 (√2 − 1) / 3: cubic control distance that approximates a quarter circle. */
const KAPPA = 0.5522847498307936;

/** Outline of a Live Shape, or the parsed `d` of a Path. */
export function shapeSegments(shape: Shape): Segment[] {
  const M = (x: number, y: number): Segment => ({ cmd: "M", args: [x, y] });
  const L = (x: number, y: number): Segment => ({ cmd: "L", args: [x, y] });
  const Z: Segment = { cmd: "Z", args: [] };
  /** Vertices on a circle, the first straight up, clockwise (y down). */
  const ring = (cx: number, cy: number, radii: number[]): Segment[] => [
    ...radii.map((r, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / radii.length;
      return (i === 0 ? M : L)(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }),
    Z,
  ];
  switch (shape.type) {
    case "rect": {
      const { x, y, width: w, height: h } = shape;
      const r = Math.min(shape.radius, w / 2, h / 2);
      if (r === 0) return [M(x, y), L(x + w, y), L(x + w, y + h), L(x, y + h), Z];
      const k = r * (1 - KAPPA);
      const C = (...args: number[]): Segment => ({ cmd: "C", args });
      return [
        M(x + r, y),
        L(x + w - r, y),
        C(x + w - k, y, x + w, y + k, x + w, y + r),
        L(x + w, y + h - r),
        C(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h),
        L(x + r, y + h),
        C(x + k, y + h, x, y + h - k, x, y + h - r),
        L(x, y + r),
        C(x, y + k, x + k, y, x + r, y),
        Z,
      ];
    }
    case "ellipse": {
      const rx = shape.width / 2;
      const ry = shape.height / 2;
      const cx = shape.x + rx;
      const cy = shape.y + ry;
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      return [
        M(cx, cy - ry),
        { cmd: "C", args: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
        { cmd: "C", args: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
        { cmd: "C", args: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
        { cmd: "C", args: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
        Z,
      ];
    }
    case "line":
      return [M(shape.x1, shape.y1), L(shape.x2, shape.y2)];
    case "polygon":
      return ring(shape.cx, shape.cy, Array(shape.sides).fill(shape.radius));
    case "star":
      return ring(
        shape.cx,
        shape.cy,
        Array.from({ length: shape.points * 2 }, (_, i) =>
          i % 2 ? shape.innerRadius : shape.outerRadius,
        ),
      );
    case "path":
      return parsePath(shape.d, "d");
  }
}
