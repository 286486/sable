import { Rect } from "@zibel/core";
import { z } from "zod";

export const CreatedDocumentOutput = z.object({
  docId: z.string(),
  defaultLayerId: z.string(),
  artboards: z.array(
    z.object({ id: z.string(), name: z.string(), frame: Rect, background: z.string().optional() }),
  ),
  rev: z.number().int(),
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
