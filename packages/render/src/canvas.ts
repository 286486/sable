import {
  BUNDLED_FONT,
  childrenOf,
  clippingPath,
  type Document,
  type LeafNode,
  layoutText,
  type Node,
  type Segment,
  shapeSegments,
  transformSegments,
} from "@zibel/core";

type Stroke = LeafNode["appearance"]["strokes"][number];

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
  font: string;
  fontKerning: "auto" | "normal" | "none";
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
  fill(rule?: "nonzero" | "evenodd"): void;
  clip(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
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
    // A Clipping Mask's children draw only inside its Clipping Path, which never paints (ADR-0021).
    const clip = clippingPath(doc, n);
    if (clip) {
      trace(ctx, transformSegments(shapeSegments(clip), clip.transform));
      ctx.clip(clip.type === "path" && clip.fillRule === "evenodd" ? "evenodd" : "nonzero");
    }
    for (const c of childrenOf(doc, n.id)) if (c !== clip) draw(ctx, doc, c);
  } else if (n.type === "image") {
    // ponytail: drawn once the canvas is given the decoded files (#32 U11).
  } else {
    // Overflowing Area Type is not laid out, so it is not drawn (ADR-0022).
    const lines = n.type === "text" ? layoutText(n).lines : null;
    // Tested on n, not lines, so the else branch narrows n to a Live Shape or Path.
    if (n.type === "text") {
      // Every font renders in the bundled one, which its bounds are measured in (ADR-0017).
      ctx.font = `${n.fontSize}px "${BUNDLED_FONT}"`;
      // Unkerned, like the SVG, so the drawn width is the advance sum (ADR-0013).
      ctx.fontKerning = "none";
    } else {
      trace(ctx, shapeSegments(n));
    }
    for (const f of n.appearance.fills) {
      ctx.fillStyle = f.color;
      if (lines) for (const l of lines) ctx.fillText(l.text, l.x, l.y);
      else if (n.type === "path" && n.fillRule === "evenodd") ctx.fill("evenodd");
      else ctx.fill();
    }
    for (const s of n.appearance.strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = s.cap;
      ctx.lineJoin = s.join;
      ctx.miterLimit = s.miterLimit;
      ctx.setLineDash(s.dash);
      if (lines) for (const l of lines) ctx.strokeText(l.text, l.x, l.y);
      else ctx.stroke();
    }
  }
  ctx.restore();
}

function trace(ctx: Canvas2D, segments: Segment[]) {
  ctx.beginPath();
  for (const { cmd, args: a } of segments) {
    if (cmd === "M") ctx.moveTo(...(a as [number, number]));
    else if (cmd === "L") ctx.lineTo(...(a as [number, number]));
    else if (cmd === "C")
      ctx.bezierCurveTo(...(a as [number, number, number, number, number, number]));
    else if (cmd === "Q") ctx.quadraticCurveTo(...(a as [number, number, number, number]));
    else ctx.closePath();
  }
}
