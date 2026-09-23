import { z } from "zod";

/** `#RRGGBB` or `#RRGGBBAA`, case-insensitive (REQUIREMENTS §6.5). */
export const Color = z
  .string()
  .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Colors are #RRGGBB or #RRGGBBAA, e.g. #FF8800.");

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

// ponytail: solid Fills and one-width Strokes only; cap, join, dash and gradients arrive with #3.
export const Appearance = z.object({
  fills: z.array(z.object({ color: Color })).default([]),
  strokes: z.array(z.object({ color: Color, width: z.number().positive().default(1) })).default([]),
});
export type Appearance = z.infer<typeof Appearance>;

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

export const RectInput = z.object({
  type: z.literal("rect"),
  parentId: z.string().describe("Id of a Layer or Group. doc_create returns the default Layer id."),
  clientKey: z
    .string()
    .optional()
    .describe("Your own key for this item; the receipt's keyMap maps it to the new id."),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  appearance: Appearance.optional(),
});
export const NodeInput = RectInput;
export type NodeInput = z.input<typeof NodeInput>;

/** `[a, b, c, d, e, f]` with SVG semantics. */
export type Matrix = [number, number, number, number, number, number];

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

export interface RectNode extends NodeBase, Rect {
  type: "rect";
  appearance: Appearance;
}

export type Node = LayerNode | RectNode;

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
