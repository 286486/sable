import { type ErrorData, newId, ZibelError } from "@zibel/core";
import type { DocumentService } from "@zibel/sync";

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
  };
}

function unwrap<T extends object>(result: T): Exclude<T, { error: ErrorData }> {
  if ("error" in result) throw new ZibelError(result.error as ErrorData);
  return result as Exclude<T, { error: ErrorData }>;
}
