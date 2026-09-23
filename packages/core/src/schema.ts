import { z } from "zod";
import { COLOR_PATTERN } from "./color.ts";

/**
 * `#RRGGBB` or `#RRGGBBAA`, case-insensitive (REQUIREMENTS §6.5). The published schema carries the
 * pattern, but any value parses so core can answer INVALID_COLOR with a conversion hint instead of
 * the MCP SDK's generic validation text.
 */
export const Color = z.unknown().meta({
  type: "string",
  pattern: COLOR_PATTERN,
  description: "#RRGGBB or #RRGGBBAA, e.g. #FF8800.",
});

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

export const Fill = z.object({ type: z.literal("solid").default("solid"), color: Color });
export const Stroke = z.object({
  color: Color,
  width: z.number().positive().default(1),
  cap: z.enum(["butt", "round", "square"]).default("butt"),
  join: z.enum(["miter", "round", "bevel"]).default("miter"),
  miterLimit: z.number().min(1).max(500).default(10),
  dash: z
    .array(z.number().nonnegative())
    .default([])
    .describe("Alternating dash and gap lengths in pt, e.g. [4, 2]; empty for a solid Stroke."),
});
// ponytail: solid Fills only; gradients and patterns arrive with their own issue.
export type AppearanceInput = z.output<typeof AppearanceInput>;
export const AppearanceInput = z.object({
  fills: z.array(Fill).default([]).describe("Painted bottom to top."),
  strokes: z.array(Stroke).default([]).describe("Painted bottom to top, above every Fill."),
});

type Painted<T extends z.ZodType> = Omit<z.output<T>, "color"> & { color: string };
export interface Appearance {
  fills: Painted<typeof Fill>[];
  strokes: Painted<typeof Stroke>[];
}

export const ArtboardInput = z.object({
  name: z.string().optional(),
  x: z
    .number()
    .optional()
    .describe("Left edge in document coordinates. Default: right of the previous Artboard."),
  y: z.number().default(0),
  width: z.number().positive(),
  height: z.number().positive(),
  background: Color.optional(),
});
export type ArtboardInput = z.input<typeof ArtboardInput>;

export interface Artboard {
  id: string;
  name: string;
  frame: Rect;
  background?: string;
}

const size = z.number().nonnegative();
const count = z.number().int().min(3).max(1000);

/** Live Shape parameters (F-DRAW-01) and a Path's `d`, in document coordinates. */
export const RectShape = z.object({
  type: z.literal("rect"),
  x: z.number(),
  y: z.number(),
  width: size,
  height: size,
  radius: size.default(0).describe("Corner radius, clamped to half the shorter side."),
});
export const EllipseShape = z.object({
  type: z.literal("ellipse"),
  x: z.number().describe("Left edge of the bounding box."),
  y: z.number().describe("Top edge of the bounding box."),
  width: size,
  height: size,
});
export const LineShape = z.object({
  type: z.literal("line"),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});
export const PolygonShape = z.object({
  type: z.literal("polygon"),
  cx: z.number(),
  cy: z.number(),
  radius: size.describe("Center to each vertex; the first vertex is straight up."),
  sides: count,
});
export const StarShape = z.object({
  type: z.literal("star"),
  cx: z.number(),
  cy: z.number(),
  outerRadius: size.describe("Center to each point; the first point is straight up."),
  innerRadius: size.describe("Center to each inner vertex."),
  points: count,
});
export const PathShape = z.object({
  type: z.literal("path"),
  d: z.string().describe("SVG path data, absolute M, L, C, Q and Z only, e.g. M 0 0 L 10 0 Z."),
});
export const Shape = z.discriminatedUnion("type", [
  RectShape,
  EllipseShape,
  LineShape,
  PolygonShape,
  StarShape,
  PathShape,
]);
export type Shape = z.output<typeof Shape>;

const clientKey = z
  .string()
  .optional()
  .describe("Your own key for this item; the receipt's keyMap maps it to the new id.");
const item = {
  clientKey,
  name: z.string().optional(),
};
const leaf = {
  ...item,
  appearance: AppearanceInput.optional().describe(
    "Omit for Illustrator's default, a white Fill and a 1 pt black Stroke; {} paints nothing.",
  ),
};
const RectItem = RectShape.extend(leaf);
const EllipseItem = EllipseShape.extend(leaf);
const LineItem = LineShape.extend(leaf);
const PolygonItem = PolygonShape.extend(leaf);
const StarItem = StarShape.extend(leaf);
const PathItem = PathShape.extend(leaf);
const LEAF_ITEMS = [RectItem, EllipseItem, LineItem, PolygonItem, StarItem, PathItem] as const;
type LeafItem = (typeof LEAF_ITEMS)[number];
interface GroupChild {
  type: "group";
  clientKey?: string;
  name?: string;
  children: ChildInput[];
}
interface GroupChildIn extends Omit<GroupChild, "children"> {
  children?: ChildIn[];
}
/**
 * A Node created inline in a Group, without `parentId`. `layer` parses only so core can reject it with
 * INVALID_PARENT and a hint rather than the MCP SDK's generic validation text.
 */
export type ChildInput = z.output<LeafItem> | GroupChild | z.output<typeof InlineLayer>;
type ChildIn = z.input<LeafItem> | GroupChildIn | z.input<typeof InlineLayer>;
const InlineLayer = z.object({ type: z.literal("layer"), ...item });
const ChildInput: z.ZodType<ChildInput, ChildIn> = z.lazy(() =>
  z.discriminatedUnion("type", [...LEAF_ITEMS, GroupItem, InlineLayer]),
);
const GroupItem = z.object({
  type: z.literal("group"),
  ...item,
  children: z.array(ChildInput).default([]).describe("Created inside this Group, bottom to top."),
});

const parentId = z
  .string()
  .describe("Id of a Layer or Group, never an Artboard. doc_create returns the default Layer id.");
export const NodeInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("layer"),
    ...item,
    parentId: z
      .string()
      .nullable()
      .default(null)
      .describe("Id of the parent Layer; omit or null for a top-level Layer."),
  }),
  ...[...LEAF_ITEMS, GroupItem].map((s) => s.extend({ parentId })),
]);
export type NodeInput = z.input<typeof NodeInput>;

/** `[a, b, c, d, e, f]` with SVG semantics. */
export type Matrix = [number, number, number, number, number, number];

const nodeIds = z.array(z.string()).min(1).max(1000);

/** Illustrator's 9-point reference point, as fractions of the bounds' width and height. */
export const PIVOTS = {
  topLeft: [0, 0],
  top: [0.5, 0],
  topRight: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottomLeft: [0, 1],
  bottom: [0.5, 1],
  bottomRight: [1, 1],
} as const;
const nonZero = z.number().refine((n) => n !== 0, "Scale by a non-zero factor.");
const xy = z.object({ x: z.number().default(0), y: z.number().default(0) });

export const TransformInput = z
  .object({
    nodeIds,
    translate: xy.optional().describe("Move by x, y in pt, after everything else."),
    rotate: z.number().optional().describe("Degrees, clockwise on screen."),
    scale: z
      .union([nonZero, z.object({ x: nonZero, y: nonZero })])
      .optional()
      .describe("A factor, or one per axis; negative mirrors."),
    skew: xy.optional().describe("Degrees, as SVG skewX (x) and skewY (y)."),
    matrix: z
      .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
      .optional()
      .describe("[a, b, c, d, e, f] applied about the pivot, instead of rotate, skew and scale."),
    pivot: z
      .union([
        z.enum(Object.keys(PIVOTS) as [keyof typeof PIVOTS]),
        z.object({ x: z.number(), y: z.number() }),
      ])
      .default("center")
      .describe("Reference point on the targets' geometricBounds, or document coordinates."),
    each: z
      .boolean()
      .default(false)
      .describe("true: each target about its own pivot; false: all about one pivot."),
    scaleStrokes: z
      .boolean()
      .default(true)
      .describe("false keeps the rendered Stroke width by dividing the stored width."),
  })
  .refine(
    (t) => [t.translate, t.rotate, t.scale, t.skew, t.matrix].some((v) => v !== undefined),
    "Give at least one of translate, rotate, scale, skew or matrix.",
  )
  .refine(
    (t) => t.matrix === undefined || [t.rotate, t.scale, t.skew].every((v) => v === undefined),
    "matrix replaces rotate, scale and skew; send it alone (translate may accompany it).",
  );
export type TransformInput = z.input<typeof TransformInput>;

/** Common properties (F-DOC-02). */
interface NodeBase {
  id: string;
  name: string;
  parentId: string | null;
  /** Fractional-index key ordering siblings (ADR-0002). */
  index: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  transform: Matrix;
  tags: string[];
  meta: Record<string, unknown>;
}

export interface LayerNode extends NodeBase {
  type: "layer";
}

export interface GroupNode extends NodeBase {
  type: "group";
}

/** A Live Shape or Path: its parameters plus an Appearance. */
export type ShapeNode = NodeBase & Shape & { appearance: Appearance };

export type Node = LayerNode | GroupNode | ShapeNode;

export interface Document {
  id: string;
  name: string;
  /** Schema version. */
  version: 1;
  rev: number;
  artboards: Artboard[];
  nodes: Map<string, Node>;
}

/** The uniform result of every write (REQUIREMENTS §6.5). */
export const WriteReceipt = z.object({
  txId: z.string(),
  rev: z.number().int(),
  createdIds: z.array(z.string()),
  updatedIds: z.array(z.string()),
  deletedIds: z.array(z.string()),
  keyMap: z.record(z.string(), z.string()),
  bounds: Rect.nullable(),
  warnings: z.array(
    z.object({ code: z.string(), nodeId: z.string().optional(), message: z.string() }),
  ),
});
export type WriteReceipt = z.infer<typeof WriteReceipt>;
