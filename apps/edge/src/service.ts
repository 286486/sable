import { type ErrorData, newId, ZibelError } from "@zibel/core";
import { parseFile } from "@zibel/io";
import { svgToPng } from "@zibel/render";
import type { DocumentService } from "@zibel/sync";

/** DocumentService over one Document Durable Object per docId, acting as `actor`. */
export function documentService(env: Env, actor: string): DocumentService {
  const doc = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));
  // ponytail: a failed insert leaves the Document unlisted; reconcile from the DOs if that shows up.
  const index = (docId: string, name: string) =>
    env.DB.prepare("INSERT INTO documents (id, name, created_at) VALUES (?, ?, ?)")
      .bind(docId, name, new Date().toISOString())
      .run();
  return {
    create: async (input) => {
      const docId = newId();
      const created = unwrap(await doc(docId).create({ ...input, docId, actor }));
      await index(docId, input.name);
      return created;
    },
    open: async ({ content, name, intent }) => {
      // Parsed here, before any Durable Object or D1 row exists, so a bad file creates nothing.
      const { warnings, ...file } = parseFile(content, { name });
      const docId = newId();
      const opened = unwrap(await doc(docId).open({ ...file, docId, actor, intent }));
      await index(docId, file.name);
      return { ...opened, warnings };
    },
    replace: async (docId, { content, baseRev, ifRev, intent }) =>
      unwrap(await doc(docId).replace(parseFile(content), actor, { baseRev, ifRev, intent })),
    place: async (docId, { svg, name, ...opts }) => {
      let file: ReturnType<typeof parseFile>;
      try {
        file = parseFile(svg, { name });
      } catch (e) {
        // The file is Place's `svg`, not Open's `content`.
        if (e instanceof ZibelError && e.data.path === "content") {
          throw new ZibelError({ ...e.data, path: "svg" });
        }
        throw e;
      }
      return unwrap(await doc(docId).place(file, actor, opts));
    },
    list: async () => ({ documents: await listDocuments(env) }),
    info: async (docId) => unwrap(await doc(docId).info()),
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
    outline: async (docId, opts, txId) => unwrap(await doc(docId).outline(opts, actor, txId)),
    query: async (docId, q, txId) => unwrap(await doc(docId).query(q, actor, txId)),
    begin: async (docId, label) => unwrap(await doc(docId).begin(actor, label)),
    commitTx: async (docId, txId, opts) => unwrap(await doc(docId).commitTx(txId, actor, opts)),
    rollback: async (docId, txId) => unwrap(await doc(docId).rollback(txId, actor)),
    changes: async (docId, sinceRev, limit) => unwrap(await doc(docId).changes(sinceRev, limit)),
    render: async (docId, req) => {
      const { svg, viewport } = unwrap(await doc(docId).raster(actor, req));
      const { png } = await svgToPng(svg, viewport.scale);
      return { png, viewport };
    },
    svg: async (docId, req) => unwrap(await doc(docId).svg(actor, req)),
    file: async (docId, txId) => unwrap(await doc(docId).file(actor, txId)),
  };
}

function unwrap<T extends object>(result: T): Exclude<T, { error: ErrorData }> {
  if ("error" in result) throw new ZibelError(result.error as ErrorData);
  return result as Exclude<T, { error: ErrorData }>;
}

/** Every Document, newest first, for the list page and `doc_list`. */
export async function listDocuments(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT id AS docId, name, created_at AS createdAt FROM documents ORDER BY rowid DESC",
  ).all<{ docId: string; name: string; createdAt: string }>();
  return results;
}
