import { ZibelError } from "./errors.ts";
import type { Rect } from "./schema.ts";

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
  const xs: number[] = [];
  const ys: number[] = [];
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
    xs.push(x);
    ys.push(y);
    if (cmd === "C" || cmd === "Q") {
      const px = [x0, ...args.filter((_, k) => k % 2 === 0)];
      const py = [y0, ...args.filter((_, k) => k % 2 === 1)];
      for (const t of extrema(px)) xs.push(bezier(px, t));
      for (const t of extrema(py)) ys.push(bezier(py, t));
    }
    if (cmd === "M") start = end;
    cur = end;
  }
  if (xs.length === 0) return null;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
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
