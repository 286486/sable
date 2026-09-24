import { z } from "zod";
import { COLOR_PATTERN } from "./color.ts";
import { compose, scaleOf } from "./matrix.ts";

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

/** What `render` and `export` draw (ADR-0014); omitted, the whole Document. */
export const RenderScope = z.union([
  z.strictObject({ artboardId: z.string() }),
  z.strictObject({ nodeIds: z.array(z.string()).min(1).max(1000) }),
  z.strictObject({
    rect: Rect.extend({ width: z.number().positive(), height: z.number().positive() }),
  }),
]);
export type RenderScope = z.infer<typeof RenderScope>;

export const RenderOverlay = z.enum(["bounds", "ids", "artboards"]);
export type RenderOverlay = z.infer<typeof RenderOverlay>;

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
  fillRule: z
    .enum(["nonzero", "evenodd"])
    .default("nonzero")
    .describe(
      "Several subpaths in one d make a Compound Path (ADR-0018): under evenodd every inner subpath is a hole; under nonzero only one that winds the other way.",
    ),
});
export const SHAPES = {
  rect: RectShape,
  ellipse: EllipseShape,
  line: LineShape,
  polygon: PolygonShape,
  star: StarShape,
  path: PathShape,
};
const { rect, ...others } = SHAPES;
export const Shape = z.discriminatedUnion("type", [rect, ...Object.values(others)]);
export type Shape = z.output<typeof Shape>;

/** Point Type (ADR-0013): one line from the baseline origin, measured in the one bundled font. */
export const TextShape = z.object({
  type: z.literal("text"),
  kind: z.literal("point").default("point"),
  x: z.number().describe("Where the baseline of the first character starts."),
  y: z.number().describe("The baseline."),
  content: z
    .string()
    .min(1)
    .max(10_000)
    .refine(
      // Control characters (tab, return) and line separators draw as spaces but measure as .notdef.
      (s) => !/[\p{Cc}\u2028\u2029]/u.test(s),
      "One line of printable characters: a hard return or tab is not laid out yet; create one text per line.",
    ),
  fontFamily: z
    .string()
    .min(1)
    .default("Source Sans 3")
    .describe(
      "Any font name, kept as written; only Source Sans 3 is bundled, and others render in it.",
    ),
  fontSize: z.number().positive().default(12).describe("In pt."),
});
export type TextShape = z.output<typeof TextShape>;

const clientKey = z
  .string()
  .optional()
  .describe("Your own key for this item; the receipt's keyMap maps it to the new id.");
const tags = z.array(z.string());
const meta = z.record(z.string(), z.unknown()).describe("Any JSON: your notes or data bindings.");
const item = {
  clientKey,
  name: z.string().optional(),
  tags: tags.optional(),
  meta: meta.optional(),
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
const TextItem = TextShape.extend({
  ...leaf,
  appearance: AppearanceInput.optional().describe(
    "Omit for Illustrator's default type Appearance, a black Fill and no Stroke; {} paints nothing.",
  ),
});
const LEAF_ITEMS = [
  RectItem,
  EllipseItem,
  LineItem,
  PolygonItem,
  StarItem,
  PathItem,
  TextItem,
] as const;
type LeafItem = (typeof LEAF_ITEMS)[number];
interface GroupChild {
  type: "group";
  clientKey?: string;
  name?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
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

/** Illustrator's 16 blend modes, by their CSS names. */
export const BlendMode = z.enum([
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

/** What `node_update` may write on every Node; a leaf adds its parameters and `appearance`. */
export const Writable = z.object({
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(1),
  blendMode: BlendMode,
  tags,
  meta,
});

const unwrapDefault = (t: z.ZodType) => (t instanceof z.ZodDefault ? t.unwrap() : t);
const parameters = Object.fromEntries(
  [TextShape, ...Object.values(SHAPES)]
    .flatMap((o) => Object.entries(o.shape))
    .filter(([k]) => k !== "type" && k !== "kind")
    .map(([k, t]) => [k, unwrapDefault(t as z.ZodType)]),
);

/**
 * The published `node_update` patch. Nothing here has a default, or the MCP SDK would insert it into
 * the patch and overwrite the stored value. Loose, so read-only keys reach core and get a hint; every
 * key is nullable because null deletes in a merge patch.
 */
export const NodePatch = z
  .looseObject(
    Object.fromEntries(
      Object.entries({
        ...Writable.shape,
        appearance: z.object({ fills: z.array(Fill), strokes: z.array(Stroke) }).partial(),
        ...parameters,
      }).map(([k, t]) => [k, (t as z.ZodType).nullable().optional()]),
    ),
  )
  .describe(
    "JSON Merge Patch (RFC 7396) of the Node's writable properties: objects merge, null deletes, arrays and everything else replace.",
  );

export const UpdateInput = z.object({ nodeId: z.string(), patch: NodePatch });
export type UpdateInput = z.input<typeof UpdateInput>;

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
  )
  .refine(
    // A singular matrix collapses the Nodes for good: nothing composed onto it can undo it.
    (t) => scaleOf(compose(t, { x: 0, y: 0 })) > 1e-6,
    "The transform collapses the Nodes to a line or point; use a non-singular matrix and skews whose sum stays away from 90°.",
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
  blendMode: z.infer<typeof BlendMode>;
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
export type ShapeNode = NodeBase &
  Shape & {
    appearance: Appearance;
    /** The Clipping Path of its Group (ADR-0021); missing means false. */
    clipping?: boolean;
  };

export type TextNode = NodeBase & TextShape & { appearance: Appearance };

/** A Node that paints: a Live Shape, a Path or a text. */
export type LeafNode = ShapeNode | TextNode;

export type Node = LayerNode | GroupNode | LeafNode;

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
  failed: z
    .array(
      z.object({
        index: z.number().int(),
        code: z.string(),
        message: z.string(),
        hint: z.string(),
        path: z.string().optional(),
      }),
    )
    .optional()
    .describe("Only with partial: true. The items that did not apply, by input index."),
});
export type WriteReceipt = z.infer<typeof WriteReceipt>;

/** Every Node type once: the Record fails to compile when a type is added or dropped. */
const NODE_TYPES = {
  layer: true,
  group: true,
  rect: true,
  ellipse: true,
  line: true,
  polygon: true,
  star: true,
  path: true,
  text: true,
} satisfies Record<Node["type"], true>;
export const NodeType = z.enum(Object.keys(NODE_TYPES) as [Node["type"]]);

const compiles = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/** A Node Query's filters and page (ADR-0015): every filter given must hold. */
export const NodeQuery = z.object({
  types: z.array(NodeType).min(1).optional(),
  // ponytail: the length cap is the only guard against a slow pattern; add a time budget with a spatial index.
  nameRegex: z
    .string()
    .max(200)
    .refine(compiles, "Not a valid JavaScript regular expression.")
    .optional()
    .describe("JavaScript regular expression, no flags, tested against the stored name."),
  tags: z.array(z.string()).min(1).optional().describe("The Node carries every one of these."),
  parentId: z
    .string()
    .optional()
    .describe("The Node's direct parent; deeper descendants do not match."),
  withinRect: Rect.optional().describe("geometricBounds entirely inside, edges included."),
  intersectsRect: Rect.optional().describe("geometricBounds touching, edges included."),
  limit: z.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional().describe("nextCursor from the previous page."),
});
export type NodeQuery = z.input<typeof NodeQuery>;
