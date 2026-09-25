// SVG gradients folded into Zibel's (ADR-0026): whatever maps a gradient's own space into the leaf's
// coordinates (gradientTransform, objectBoundingBox, the leaf's bake) is applied to its geometry,
// and SVG's reflect and repeat are unrolled into stops, so what is stored draws the same pixels.
import { applyTo, type ColorStop, type Gradient, type Matrix, type Point } from "@zibel/core";

const n3 = (n: number) => Math.round(n * 1000) / 1000 || 0;
const point = ([x, y]: [number, number]) => ({ x: n3(x), y: n3(y) });

/** A gradient's geometry in its own space, as SVG's attributes give it. */
export type Geometry =
  | { type: "linear"; p1: Point; p2: Point }
  | { type: "radial"; c: Point; r: number; f: Point };

/** Where `q` falls along the gradient: 0 at the first stop, 1 at the last. */
function along(g: Geometry, q: Point): number {
  if (g.type === "linear") {
    const [dx, dy] = [g.p2.x - g.p1.x, g.p2.y - g.p1.y];
    return ((q.x - g.p1.x) * dx + (q.y - g.p1.y) * dy) / (dx * dx + dy * dy);
  }
  // The t whose circle, centred at f + t(c - f) with radius t·r, passes through q.
  const [wx, wy] = [q.x - g.f.x, q.y - g.f.y];
  const [ex, ey] = [g.c.x - g.f.x, g.c.y - g.f.y];
  const a = ex * ex + ey * ey - g.r * g.r;
  const b = wx * ex + wy * ey;
  const c = wx * wx + wy * wy;
  // a < 0 with the focus inside the circle, so one root is not negative.
  return Math.abs(a) < 1e-12 ? c / (2 * b) : (b - Math.sqrt(b * b - a * c)) / a;
}

// ponytail: a gradient far smaller than its element unrolls into at most this many periods, then
// pads; raise it if a real file needs more.
const MAX_PERIODS = 64;

/**
 * SVG's reflect or repeat as stops over a pad gradient that covers `corners` (the element's visible
 * bounds in the gradient's own space), so pad draws the same colours.
 */
export function unroll(
  g: Geometry,
  stops: ColorStop[],
  spread: "reflect" | "repeat",
  corners: Point[],
): { g: Geometry; stops: ColorStop[] } {
  const ts = corners.map((q) => along(g, q));
  let from = g.type === "linear" ? Math.floor(Math.min(0, ...ts)) : 0;
  let to = Math.ceil(Math.max(1, ...ts));
  if (to - from > MAX_PERIODS) {
    from = Math.max(from, -MAX_PERIODS / 2);
    to = from + MAX_PERIODS;
  }
  const out: ColorStop[] = [];
  for (let k = from; k < to; k++) {
    const period =
      spread === "reflect" && Math.abs(k) % 2 === 1
        ? stops.map((s) => ({ ...s, offset: 1 - s.offset })).reverse()
        : stops;
    for (const s of period) out.push({ ...s, offset: n3((k - from + s.offset) / (to - from)) });
  }
  if (g.type === "linear") {
    const [dx, dy] = [g.p2.x - g.p1.x, g.p2.y - g.p1.y];
    const at = (t: number) => ({ x: g.p1.x + t * dx, y: g.p1.y + t * dy });
    return { g: { type: "linear", p1: at(from), p2: at(to) }, stops: out };
  }
  // Scaling the circles about the focus by `to` keeps every t / to on the same circle.
  const c = { x: g.f.x + to * (g.c.x - g.f.x), y: g.f.y + to * (g.c.y - g.f.y) };
  return { g: { ...g, c, r: g.r * to }, stops: out };
}

/**
 * The gradient in the space `m` maps its own space into. A linear gradient stays linear, its end
 * recomputed so the stops keep their places; a radial one becomes an ellipse, its focus mapped.
 */
export function mapped(g: Geometry, stops: ColorStop[], m: Matrix): Gradient {
  const [a, b, c, d] = m;
  if (g.type === "linear") {
    const [dx, dy] = [g.p2.x - g.p1.x, g.p2.y - g.p1.y];
    // The gradient's direction goes through the inverse transpose; its length through 1 / |g|².
    const det = a * d - b * c;
    const len = dx * dx + dy * dy;
    const [gx, gy] = [(d * dx - b * dy) / det / len, (a * dy - c * dx) / det / len];
    const [sx, sy] = applyTo(m, g.p1.x, g.p1.y);
    const g2 = gx * gx + gy * gy;
    return {
      type: "linear",
      stops,
      start: point([sx, sy]),
      end: point([sx + gx / g2, sy + gy / g2]),
    };
  }
  let angle: number;
  let major: number;
  let minor: number;
  if (Math.abs(a * c + b * d) < 1e-5 * (a * a + b * b + c * c + d * d)) {
    // Columns at right angles, as a move, turn and scale make, and Zibel's own export: the ellipse's
    // axes are the images of the circle's, so the radius stays along the first.
    angle = Math.atan2(b, a);
    major = Math.hypot(a, b);
    minor = Math.hypot(c, d);
  } else {
    // A skew: the axes from the singular value decomposition.
    const [e, f, h, k] = [(a + d) / 2, (a - d) / 2, (b + c) / 2, (b - c) / 2];
    const [q, r] = [Math.hypot(e, k), Math.hypot(f, h)];
    angle = (Math.atan2(h, f) + Math.atan2(k, e)) / 2;
    major = q + r;
    minor = Math.abs(q - r);
  }
  const degrees = (((angle * 180) / Math.PI) % 360) + 360;
  return {
    type: "radial",
    stops,
    center: point(applyTo(m, g.c.x, g.c.y)),
    radius: n3(g.r * major),
    aspectRatio: n3(minor / major),
    angle: n3(degrees % 360),
    focus: point(applyTo(m, g.f.x, g.f.y)),
  };
}
