import { Rect } from "@zibel/core";
import { z } from "zod";

const Artboards = z.array(
  z.object({ id: z.string(), name: z.string(), frame: Rect, background: z.string().optional() }),
);

export const CreatedDocumentOutput = z.object({
  docId: z.string(),
  defaultLayerId: z.string(),
  artboards: Artboards,
  rev: z.number().int(),
});

export const DocInfoOutput = z.object({
  docId: z.string(),
  name: z.string(),
  artboards: Artboards,
  nodeCount: z.number().int(),
  rev: z.number().int(),
  browsers: z.number().int(),
});

const OutlineNode = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  bounds: Rect.nullable(),
  childCount: z.number().int(),
  visible: z.boolean(),
  locked: z.boolean(),
  get children() {
    return z.array(OutlineNode).optional();
  },
});

export const OutlineOutput = z.object({ rev: z.number().int(), layers: z.array(OutlineNode) });

export const RenderOutput = z.object({
  viewport: z.object({
    docRect: Rect,
    pixelSize: z.object({ width: z.number().int(), height: z.number().int() }),
    scale: z.number(),
  }),
});

/** A `node_get` entry: the concise fields typed; `full` adds the stored and derived properties. */
const NodeView = z.looseObject({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
  childCount: z.number().int(),
  geometricBounds: Rect.nullable(),
});

export const NodeGetOutput = z.object({ rev: z.number().int(), nodes: z.array(NodeView) });

export const TxOutput = z.object({ txId: z.string(), rev: z.number().int() });

export const ChangesOutput = z.object({
  rev: z.number().int(),
  changes: z.array(
    z.object({
      rev: z.number().int(),
      txId: z.string(),
      actor: z.string(),
      summary: z.string(),
      createdIds: z.array(z.string()),
      updatedIds: z.array(z.string()),
      deletedIds: z.array(z.string()),
      intent: z.string().nullable(),
    }),
  ),
});
