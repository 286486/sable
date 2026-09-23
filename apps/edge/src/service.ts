import { type ErrorData, newId, ZibelError } from "@zibel/core";
import { svgToPng } from "@zibel/render";
import type { DocumentService } from "@zibel/sync";

const MAX_RENDER_SIDE = 4096;

/** DocumentService over one Document Durable Object per docId, acting as `actor`. */
export function documentService(env: Env, actor: string): DocumentService {
  const doc = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));
  return {
    create: (input) => {
      const docId = newId();
      return doc(docId).create({ ...input, docId, actor });
    },
    createNodes: async (docId, nodes) => unwrap(await doc(docId).createNodes(nodes, actor)),
    outline: async (docId, depth) => unwrap(await doc(docId).outline(depth)),
    render: async (docId, scale) => {
      const { svg, docRect } = unwrap(await doc(docId).svg());
      const side = Math.ceil(Math.max(docRect.width, docRect.height) * scale);
      if (side > MAX_RENDER_SIDE) {
        throw new ZibelError({
          code: "LIMIT_EXCEEDED",
          message: `The render would be ${side} px on its longest side; the limit is ${MAX_RENDER_SIDE}.`,
          hint: `Use scale <= ${Math.floor((MAX_RENDER_SIDE / side) * scale * 100) / 100}.`,
          path: "scale",
        });
      }
      const { png, width, height } = await svgToPng(svg, scale);
      return { png, viewport: { docRect, pixelSize: { width, height }, scale } };
    },
  };
}

function unwrap<T extends object>(result: T): Exclude<T, { error: ErrorData }> {
  if ("error" in result) throw new ZibelError(result.error as ErrorData);
  return result as Exclude<T, { error: ErrorData }>;
}
