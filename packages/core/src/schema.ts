import { z } from "zod";
import { COLOR_PATTERN } from "./color.ts";
import { type ImageInfo, preserveAspectRatio } from "./image.ts";
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

/**
 * A text (ADR-0013, ADR-0022): Point Type from its baseline origin, or Area Type in its frame,
 * measured in the one bundled font. `textFrame` checks that the frame matches the kind.
 */
export const TextShape = z.object({
  type: z.literal("text"),
  kind: z
    .enum(["point", "area"])
    .default("point")
    .describe("point breaks only at hard returns; area wraps inside its width and height."),
  x: z
    .number()
    .describe("Point Type: where the first baseline starts. Area Type: the frame's left."),
  y: z.number().describe("Point Type: the first baseline. Area Type: the frame's top."),
  width: z.number().positive().optional().describe("Area Type only: the frame's width."),
  height: z.number().positive().optional().describe("Area Type only: the frame's height."),
  content: z
    .string()
    .min(1)
    .max(10_000)
    .refine(
      // Tabs, \r and line separators draw as spaces but measure as .notdef.
      (s) => !/[^\P{Cc}\n]|[\u2028\u2029]/u.test(s),
      "Printable characters and \\n for a hard return; a tab or \\r is not laid out yet.",
    ),
  fontFamily: z
    .string()
    .min(1)
    .default("Source Sans 3")
    .describe(
      "Any font name, kept as written; only Source Sans 3 is bundled, and others render in it.",
    ),
  fontSize: z.number().positive().default(12).describe("In pt."),
  leading: z
    .number()
    .positive()
    .optional()
    .describe("Distance between baselines in pt; omit for Auto, 120% of fontSize."),
});
/** Area Type needs its frame, and Point Type has none (ADR-0022). */
export function textFrame(
  t: { kind?: string; width?: number; height?: number },
  ctx: z.RefinementCtx,
) {
  for (const key of ["width", "height"] as const) {
    if (t.kind === "area" && t[key] === undefined) {
      ctx.addIssue({ code: "custom", path: [key], message: "Area Type needs width and height." });
    } else if (t.kind !== "area" && t[key] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "width and height belong to Area Type; set kind to area and pass both.",
      });
    }
  }
}
export type TextShape = z.output<typeof TextShape>;

/** An Image (ADR-0023): a file stored once per Document, drawn in a frame. */
export const ImageShape = z.object({
  type: z.literal("image"),
  src: z
    .string()
    .describe(
      "A data: URL of a PNG, JPEG or GIF file (WebP is refused: convert it to PNG), or the id of an image already in the Document, which reuses its bytes.",
    ),
  x: z.number().describe("The frame's left."),
  y: z.number().describe("The frame's top."),
  width: z
    .number()
    .positive()
    .optional()
    .describe("With height; omit both for the file's pixel size, one pt per pixel."),
  height: z.number().positive().optional(),
  preserveAspectRatio: z
    .string()
    .refine(
      (v) => preserveAspectRatio(v) !== undefined,
      "none, or xMinYMin to xMaxYMax optionally followed by meet or slice, e.g. xMidYMid meet.",
    )
    .default("none")
    .describe(
      "SVG's: none stretches the file to the frame; xMidYMid meet fits it inside, slice fills and crops.",
    ),
});
/** An Image's frame is given whole or taken from the file. */
export function imageFrame(t: { width?: number; height?: number }, ctx: z.RefinementCtx) {
  if ((t.width === undefined) === (t.height === undefined)) return;
  ctx.addIssue({
    code: "custom",
    path: [t.width === undefined ? "width" : "height"],
    message: "Give both width and height, or neither for the file's pixel size.",
  });
}

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
}).superRefine(textFrame);
const ImageItem = ImageShape.extend(item).superRefine(imageFrame);
const LEAF_ITEMS = [
  RectItem,
  EllipseItem,
  LineItem,
  PolygonItem,
  StarItem,
  PathItem,
  TextItem,
  ImageItem,
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
// An Image's frame reuses the keys above; its src is read-only (ADR-0023).
parameters.preserveAspectRatio = unwrapDefault(ImageShape.shape.preserveAspectRatio);

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

/** Illustrator's Object > Clipping Mask > Make (ADR-0021). */
export const MaskInput = z.object({
  clipNodeId: z.string().describe("The Live Shape or Path that clips; it loses its Appearance."),
  contentIds: z
    .array(z.string())
    .min(1)
    .max(1000)
    .describe("The Nodes it clips: siblings of the clip Node."),
  kind: z
    .enum(["clip", "opacity"])
    .default("clip")
    .describe("clip; an Opacity Mask (F-MASK-02) is not available yet."),
});
export type MaskInput = z.input<typeof MaskInput>;

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

/** A Node that paints with an Appearance: a Live Shape, a Path or a text. */
export type LeafNode = ShapeNode | TextNode;

export interface ImageNode extends NodeBase {
  type: "image";
  /** The SHA-256 of the file, stored once in the Document (ADR-0023). */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `none` or `<align> <meet|slice>`, as `preserveAspectRatio()` spells it. */
  preserveAspectRatio: string;
}

export type Node = LayerNode | GroupNode | LeafNode | ImageNode;

export interface Document {
  id: string;
  name: string;
  /** Schema version. */
  version: 1;
  rev: number;
  artboards: Artboard[];
  nodes: Map<string, Node>;
  /** Every image file the Document holds, by id; the bytes live outside it (ADR-0023). */
  images: Map<string, ImageInfo>;
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
  image: true,
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
