import {
  BUNDLED_FONT,
  childrenOf,
  clippingPath,
  type Document,
  type LeafNode,
  layoutText,
  type Node,
  type Rect,
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
  rect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
}

/** An Image's file, decoded for the canvas, with its pixel size. */
export interface DecodedImage {
  image: unknown;
  width: number;
  height: number;
}

/**
 * Draws the Document in document coordinates: the same scene, in the same order, as `toSvg`. An
 * Image draws once `images` has its file decoded (ADR-0023).
 */
export function drawDocument(
  ctx: Canvas2D,
  doc: Document,
  images?: (id: string) => DecodedImage | undefined,
): void {
  for (const { frame, background } of doc.artboards) {
    if (!background) continue;
    ctx.fillStyle = background;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
  for (const n of childrenOf(doc, null)) draw(ctx, doc, n, images);
}

const ALIGN = { Min: 0, Mid: 0.5, Max: 1 } as Record<string, number>;

/** Where SVG's `preserveAspectRatio` puts a file of `size` pixels in `frame`. */
export function imagePlacement(
  frame: Rect,
  size: { width: number; height: number },
  preserveAspectRatio: string,
): Rect {
  const { x, y } = frame;
  if (preserveAspectRatio === "none") return { x, y, width: frame.width, height: frame.height };
  const [align = "xMidYMid", how] = preserveAspectRatio.split(" ");
  const k = (how === "slice" ? Math.max : Math.min)(
    frame.width / size.width,
    frame.height / size.height,
  );
  const [width, height] = [size.width * k, size.height * k];
  return {
    x: x + (frame.width - width) * (ALIGN[align.slice(1, 4)] ?? 0.5),
    y: y + (frame.height - height) * (ALIGN[align.slice(5, 8)] ?? 0.5),
    width,
    height,
  };
}

function draw(
  ctx: Canvas2D,
  doc: Document,
  n: Node,
  images: ((id: string) => DecodedImage | undefined) | undefined,
) {
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
    for (const c of childrenOf(doc, n.id)) if (c !== clip) draw(ctx, doc, c, images);
  } else if (n.type === "image") {
    const file = images?.(n.src);
    if (file) {
      if (n.preserveAspectRatio.endsWith("slice")) {
        ctx.beginPath();
        ctx.rect(n.x, n.y, n.width, n.height);
        ctx.clip();
      }
      const r = imagePlacement(n, file, n.preserveAspectRatio);
      ctx.drawImage(file.image, r.x, r.y, r.width, r.height);
    }
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
