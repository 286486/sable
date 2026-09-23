import { DurableObject } from "cloudflare:workers";
import {
  type Artboard,
  type ArtboardInput,
  bounds,
  type ConciseView,
  createDocument,
  createNodes,
  type Document,
  deleteNodes,
  type ErrorData,
  type Failed,
  type FullView,
  type Node,
  type NodeInput,
  newId,
  nodeView,
  type OutlineNode,
  outline,
  type Rect,
  type TransformInput,
  transformNodes,
  type UpdateInput,
  union,
  updateNodes,
  type WriteReceipt,
  ZibelError,
} from "@zibel/core";
import { docRect, toSvg } from "@zibel/render";
import type { CreatedDocument, WriteOptions } from "@zibel/sync";

/** RPC results carry errors as data: Workers RPC keeps only the message of a thrown error. */
export type Result<T> = T | { error: ErrorData };

export interface ChangeEntry {
  rev: number;
  txId: string;
  actor: string;
  summary: string;
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  intent: string | null;
}

interface Change {
  created?: Node[];
  updated?: Node[];
  deletedIds?: string[];
}

/**
 * The authoritative store for one Document (ADR-0003). Nodes and the Transaction log are SQLite rows.
 * ponytail: every call reloads the Document from SQLite; cache it in memory when Documents get large.
 */
export class DocumentObject extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS doc (id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, artboards TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tx_log (
        rev INTEGER PRIMARY KEY, tx_id TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL,
        created_ids TEXT NOT NULL, updated_ids TEXT NOT NULL, deleted_ids TEXT NOT NULL,
        intent TEXT
      );
    `);
  }

  create(input: {
    docId: string;
    name: string;
    artboards: ArtboardInput[];
    actor: string;
    intent?: string;
  }): Result<CreatedDocument> {
    return guard(() => {
      const { doc, defaultLayerId } = createDocument({
        id: input.docId,
        name: input.name,
        artboards: input.artboards,
      });
      const { rev } = this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO doc (id, name, rev, artboards) VALUES (?, ?, 0, ?)",
          doc.id,
          doc.name,
          JSON.stringify(doc.artboards),
        );
        return this.commit(input.actor, `Create Document "${doc.name}"`, input.intent, {
          created: [...doc.nodes.values()],
        });
      });
      return { docId: doc.id, defaultLayerId, artboards: doc.artboards, rev };
    });
  }

  info(): Result<{ docId: string; name: string; rev: number; artboards: Artboard[] }> {
    return guard(() => {
      const { id, name, rev, artboards } = this.load();
      return { docId: id, name, rev, artboards };
    });
  }

  createNodes(inputs: NodeInput[], actor: string, opts: WriteOptions = {}): Result<WriteReceipt> {
    return this.write(actor, opts, "Create", (doc) => {
      const { nodes, keyMap, failed } = createNodes(doc, inputs, opts);
      return { created: nodes, keyMap, failed, bounds: union(nodes.map((n) => bounds(doc, n))) };
    });
  }

  updateNodes(
    updates: UpdateInput[],
    actor: string,
    opts: WriteOptions = {},
  ): Result<WriteReceipt> {
    return this.write(actor, opts, "Update", (doc) => {
      const { nodes, failed } = updateNodes(doc, updates, opts);
      return { updated: nodes, failed, bounds: union(nodes.map((n) => bounds(doc, n))) };
    });
  }

  transformNodes(
    input: TransformInput,
    actor: string,
    opts: WriteOptions = {},
  ): Result<WriteReceipt> {
    return this.write(actor, opts, "Transform", (doc) => {
      const { nodes, warnings, failed } = transformNodes(doc, input, opts);
      return { updated: nodes, warnings, failed, bounds: union(nodes.map((n) => bounds(doc, n))) };
    });
  }

  deleteNodes(nodeIds: string[], actor: string, opts: WriteOptions = {}): Result<WriteReceipt> {
    return this.write(actor, opts, "Delete", (doc) => deleteNodes(doc, nodeIds, opts));
  }

  /**
   * Runs one edit on a freshly loaded Document and commits it as one Transaction. Core throws before
   * changing anything it rejects, so a failure never reaches SQLite.
   */
  private write(
    actor: string,
    opts: WriteOptions,
    verb: string,
    edit: (doc: Document) => Change & {
      keyMap?: Record<string, string>;
      bounds: Rect | null;
      warnings?: WriteReceipt["warnings"];
      failed: Failed[];
    },
  ): Result<WriteReceipt> {
    return guard(() => {
      const {
        keyMap = {},
        bounds,
        warnings = [],
        failed,
        created = [],
        updated = [],
        deletedIds = [],
      } = edit(this.load());
      const count = created.length + updated.length + deletedIds.length;
      const summary = `${verb} ${count} ${count === 1 ? "Node" : "Nodes"}`;
      const { txId, rev } = this.ctx.storage.transactionSync(() =>
        this.commit(actor, summary, opts.intent, { created, updated, deletedIds }),
      );
      return {
        txId,
        rev,
        createdIds: created.map((n) => n.id),
        updatedIds: updated.map((n) => n.id),
        deletedIds,
        keyMap,
        bounds,
        warnings,
        ...(opts.partial && { failed }),
      };
    });
  }

  get(
    nodeIds: string[],
    detail: "concise" | "full",
  ): Result<{ rev: number; nodes: (ConciseView | FullView)[] }> {
    return guard(() => {
      const doc = this.load();
      const nodes = nodeIds.map((id, i) => {
        const node = doc.nodes.get(id);
        if (!node) {
          throw new ZibelError({
            code: "NODE_NOT_FOUND",
            message: `No Node with id ${id}.`,
            hint: "Use doc_outline or the ids from a WriteReceipt.",
            path: `nodeIds[${i}]`,
          });
        }
        return nodeView(doc, node, detail);
      });
      return { rev: doc.rev, nodes };
    });
  }

  outline(depth: number): Result<{ rev: number; layers: OutlineNode[] }> {
    return guard(() => {
      const doc = this.load();
      return { rev: doc.rev, layers: outline(doc, depth) };
    });
  }

  /** Doc-scope SVG. The Worker rasterises it, so PNG encoding never blocks this Document's writes. */
  svg(): Result<{ svg: string; docRect: Rect }> {
    return guard(() => {
      const doc = this.load();
      const rect = docRect(doc);
      return { svg: toSvg(doc, rect), docRect: rect };
    });
  }

  changes(sinceRev: number): Result<ChangeEntry[]> {
    return guard(() => {
      this.load();
      return this.sql
        .exec<Record<string, string | number | null>>(
          "SELECT * FROM tx_log WHERE rev > ? ORDER BY rev",
          sinceRev,
        )
        .toArray()
        .map((r) => ({
          rev: r.rev as number,
          txId: r.tx_id as string,
          actor: r.actor as string,
          summary: r.summary as string,
          createdIds: JSON.parse(r.created_ids as string),
          updatedIds: JSON.parse(r.updated_ids as string),
          deletedIds: JSON.parse(r.deleted_ids as string),
          intent: (r.intent as string | null) ?? null,
        }));
    });
  }

  private load(): Document {
    const row = this.sql
      .exec<{ id: string; name: string; rev: number; artboards: string }>("SELECT * FROM doc")
      .toArray()[0];
    if (!row) {
      throw new ZibelError({
        code: "DOC_NOT_FOUND",
        message: "Document not found.",
        hint: "Create one with zibel_doc_create, or check the docId.",
        path: "docId",
      });
    }
    const nodes = new Map<string, Node>();
    for (const { json } of this.sql.exec<{ json: string }>("SELECT json FROM nodes")) {
      const node = JSON.parse(json) as Node;
      nodes.set(node.id, node);
    }
    return {
      id: row.id,
      name: row.name,
      version: 1,
      rev: row.rev,
      artboards: JSON.parse(row.artboards),
      nodes,
    };
  }

  /** Writes the changed Nodes, bumps `rev` once and logs the Transaction. Call inside transactionSync. */
  private commit(actor: string, summary: string, intent: string | undefined, change: Change) {
    const { created = [], updated = [], deletedIds = [] } = change;
    for (const node of [...created, ...updated]) {
      this.sql.exec(
        "INSERT OR REPLACE INTO nodes (id, json) VALUES (?, ?)",
        node.id,
        JSON.stringify(node),
      );
    }
    for (const id of deletedIds) this.sql.exec("DELETE FROM nodes WHERE id = ?", id);
    const rev = this.sql
      .exec<{ rev: number }>("UPDATE doc SET rev = rev + 1 RETURNING rev")
      .one().rev;
    const txId = newId();
    const ids = (nodes: Node[]) => JSON.stringify(nodes.map((n) => n.id));
    this.sql.exec(
      "INSERT INTO tx_log VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      rev,
      txId,
      actor,
      summary,
      ids(created),
      ids(updated),
      JSON.stringify(deletedIds),
      intent ?? null,
    );
    return { txId, rev };
  }
}

function guard<T>(fn: () => T): Result<T> {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZibelError) return { error: e.data };
    throw e;
  }
}
