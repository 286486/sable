import { childrenOf, type Document, type Node, type ShapeNode, shapeSegments } from "@zibel/core";

type Stroke = ShapeNode["appearance"]["strokes"][number];

/**
 * The CanvasRenderingContext2D members drawDocument uses. Declared here because render is also
 * type-checked for workerd, which has no DOM; a browser's context satisfies it structurally.
 */
export interface Canvas2D {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: Stroke["cap"];
  lineJoin: Stroke["join"];
  miterLimit: number;
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setLineDash(segments: number[]): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
}

/** Draws the Document in document coordinates: the same scene, in the same order, as `toSvg`. */
export function drawDocument(ctx: Canvas2D, doc: Document): void {
  for (const { frame, background } of doc.artboards) {
    if (!background) continue;
    ctx.fillStyle = background;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
  for (const n of childrenOf(doc, null)) draw(ctx, doc, n);
}

function draw(ctx: Canvas2D, doc: Document, n: Node) {
  if (!n.visible) return;
  ctx.save();
  // ponytail: opacity multiplies into globalAlpha per paint, so overlapping children (or a Fill
  // under a Stroke) show through each other where SVG composites the group first; draw
  // translucent containers to an offscreen layer when that difference matters.
  ctx.globalAlpha *= n.opacity;
  ctx.transform(...n.transform);
  if (n.type === "layer" || n.type === "group") {
    for (const c of childrenOf(doc, n.id)) draw(ctx, doc, c);
  } else {
    ctx.beginPath();
    for (const { cmd, args: a } of shapeSegments(n)) {
      if (cmd === "M") ctx.moveTo(...(a as [number, number]));
      else if (cmd === "L") ctx.lineTo(...(a as [number, number]));
      else if (cmd === "C")
        ctx.bezierCurveTo(...(a as [number, number, number, number, number, number]));
      else if (cmd === "Q") ctx.quadraticCurveTo(...(a as [number, number, number, number]));
      else ctx.closePath();
    }
    for (const f of n.appearance.fills) {
      ctx.fillStyle = f.color;
      ctx.fill();
    }
    for (const s of n.appearance.strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = s.cap;
      ctx.lineJoin = s.join;
      ctx.miterLimit = s.miterLimit;
      ctx.setLineDash(s.dash);
      ctx.stroke();
    }
  }
  ctx.restore();
}
