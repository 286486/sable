import { type ErrorData, newId, ZibelError } from "@zibel/core";
import { svgToPng } from "@zibel/render";
import type { DocumentService } from "@zibel/sync";

const MAX_RENDER_SIDE = 4096;

/** DocumentService over one Document Durable Object per docId, acting as `actor`. */
export function documentService(env: Env, actor: string): DocumentService {
  const doc = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));
  return {
    create: async (input) => {
      const docId = newId();
      return unwrap(await doc(docId).create({ ...input, docId, actor }));
    },
    createNodes: async (docId, nodes, opts) =>
      unwrap(await doc(docId).createNodes(nodes, actor, opts)),
    updateNodes: async (docId, updates, opts) =>
      unwrap(await doc(docId).updateNodes(updates, actor, opts)),
    deleteNodes: async (docId, nodeIds, opts) =>
      unwrap(await doc(docId).deleteNodes(nodeIds, actor, opts)),
    transformNodes: async (docId, input, opts) =>
      unwrap(await doc(docId).transformNodes(input, actor, opts)),
    get: async (docId, nodeIds, detail, txId) =>
      unwrap(await doc(docId).get(nodeIds, detail, actor, txId)),
    outline: async (docId, depth, txId) => unwrap(await doc(docId).outline(depth, actor, txId)),
    begin: async (docId, label) => unwrap(await doc(docId).begin(actor, label)),
    commitTx: async (docId, txId, opts) => unwrap(await doc(docId).commitTx(txId, actor, opts)),
    rollback: async (docId, txId) => unwrap(await doc(docId).rollback(txId, actor)),
    changes: async (docId, sinceRev, limit) => unwrap(await doc(docId).changes(sinceRev, limit)),
    render: async (docId, scale, txId) => {
      const { svg, docRect } = unwrap(await doc(docId).svg(actor, txId));
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
