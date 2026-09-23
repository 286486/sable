import { DurableObject } from "cloudflare:workers";
import {
  type ArtboardInput,
  bounds,
  type ConciseView,
  commitTransaction,
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
  overlay,
  type Rect,
  type TransformInput,
  type TxRow,
  transformNodes,
  type UpdateInput,
  union,
  updateNodes,
  type WriteReceipt,
  ZibelError,
} from "@zibel/core";
import { docRect, toSvg } from "@zibel/render";
import type {
  ChangeEntry,
  CreatedDocument,
  DocInfo,
  DocumentMessage,
  TxMessage,
  WriteOptions,
} from "@zibel/sync";

/** RPC results carry errors as data: Workers RPC keeps only the message of a thrown error. */
export type Result<T> = T | { error: ErrorData };

/** A Transaction rolls back after this long without a call carrying its `txId` (F-HIST-02). */
const TX_IDLE_MS = 5 * 60_000;

const ENDED = {
  committed: "committed",
  rolled_back: "rolled back",
  expired: "expired after 5 minutes idle",
} as const;

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
      -- ponytail: ended tx rows are kept for TX_EXPIRED and never pruned; prune with history_list.
      CREATE TABLE IF NOT EXISTS tx (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, label TEXT, deadline INTEGER NOT NULL, ended TEXT
      );
      CREATE TABLE IF NOT EXISTS tx_nodes (
        tx_id TEXT NOT NULL, node_id TEXT NOT NULL, base TEXT, working TEXT,
        PRIMARY KEY (tx_id, node_id)
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

  /**
   * A browser subscribes by upgrading to a WebSocket (ADR-0009). Nothing awaits between load and
   * accept, so no commit can slip in before the Document message.
   */
  override fetch(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    const doc = guard(() => this.load());
    if ("error" in doc) return Response.json(doc.error, { status: 404 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const msg: DocumentMessage = {
      type: "document",
      rev: doc.rev,
      name: doc.name,
      artboards: doc.artboards,
      nodes: [...doc.nodes.values()],
    };
    server.send(JSON.stringify(msg));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends to every browser. Called after the SQLite transaction, so a dead socket cannot undo a write. */
  private broadcast(msg: TxMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // A socket that is closing; the runtime drops it from getWebSockets.
      }
    }
  }

  info(): Result<DocInfo> {
    return guard(() => {
      const { id, name, rev, artboards, nodes } = this.load();
      return {
        docId: id,
        name,
        artboards,
        nodeCount: nodes.size,
        rev,
        browsers: this.ctx.getWebSockets().length,
      };
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
   * Runs one edit on a freshly loaded Document and commits it as one Transaction, or with `txId`
   * stages it in that Transaction's overlay (ADR-0008). Core throws before changing anything it
   * rejects, so a failure never reaches SQLite.
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
      const committed = this.load();
      const doc = this.view(committed, actor, opts.txId);
      this.checkRev(committed, opts.ifRev);
      const {
        keyMap = {},
        bounds,
        warnings = [],
        failed,
        created = [],
        updated = [],
        deletedIds = [],
      } = edit(doc);
      const change = { created, updated, deletedIds };
      const { txId, rev } = this.ctx.storage.transactionSync(() =>
        opts.txId
          ? this.stage(opts.txId, committed.rev, change)
          : this.commit(actor, summary(verb, change), opts.intent, change),
      );
      if (!opts.txId) {
        this.broadcast({ type: "tx", rev, txId, actor, intent: opts.intent ?? null, ...change });
      }
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

  /** Reads see the overlay of `txId` when given (ADR-0008); `rev` is always the committed one. */
  get(
    nodeIds: string[],
    detail: "concise" | "full",
    actor: string,
    txId?: string,
  ): Result<{ rev: number; nodes: (ConciseView | FullView)[] }> {
    return guard(() => {
      const doc = this.view(this.load(), actor, txId);
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

  outline(
    depth: number,
    actor: string,
    txId?: string,
  ): Result<{ rev: number; layers: OutlineNode[] }> {
    return guard(() => {
      const doc = this.view(this.load(), actor, txId);
      return { rev: doc.rev, layers: outline(doc, depth) };
    });
  }

  /** Doc-scope SVG. The Worker rasterises it, so PNG encoding never blocks this Document's writes. */
  svg(actor: string, txId?: string): Result<{ svg: string; docRect: Rect }> {
    return guard(() => {
      const doc = this.view(this.load(), actor, txId);
      const rect = docRect(doc);
      return { svg: toSvg(doc, rect), docRect: rect };
    });
  }

  async begin(actor: string, label?: string): Promise<Result<{ txId: string; rev: number }>> {
    const result = guard(() => {
      const { rev } = this.load();
      const txId = newId();
      this.sql.exec(
        "INSERT INTO tx (id, actor, label, deadline) VALUES (?, ?, ?, ?)",
        txId,
        actor,
        label ?? null,
        Date.now() + TX_IDLE_MS,
      );
      return { txId, rev };
    });
    await this.schedule();
    return result;
  }

  /** Applies the overlay onto the Document as committed now: one `rev`, one log row. */
  commitTx(
    txId: string,
    actor: string,
    opts: { ifRev?: number; intent?: string } = {},
  ): Result<WriteReceipt> {
    return guard(() => {
      const doc = this.load();
      const { label } = this.openTx(txId, actor);
      this.checkRev(doc, opts.ifRev);
      const before = { ...doc, nodes: new Map(doc.nodes) };
      const change = commitTransaction(doc, this.rows(txId));
      const { created, updated, deletedIds } = change;
      const { rev } = this.ctx.storage.transactionSync(() => {
        this.end(txId, "committed");
        return this.commit(actor, label ?? summary("Commit", change), opts.intent, change, txId);
      });
      this.broadcast({ type: "tx", rev, txId, actor, intent: opts.intent ?? null, ...change });
      return {
        txId,
        rev,
        createdIds: created.map((n) => n.id),
        updatedIds: updated.map((n) => n.id),
        deletedIds,
        keyMap: {},
        bounds: union([
          ...[...created, ...updated].map((n) => bounds(doc, n)),
          ...deletedIds.map((id) => bounds(before, before.nodes.get(id) as Node)),
        ]),
        warnings: [],
      };
    });
  }

  rollback(txId: string, actor: string): Result<{ txId: string; rev: number }> {
    return guard(() => {
      const { rev } = this.load();
      this.openTx(txId, actor);
      this.end(txId, "rolled_back");
      return { txId, rev };
    });
  }

  /** Rolls back every Transaction past its deadline, then waits for the next one. */
  override async alarm(): Promise<void> {
    const due = this.sql
      .exec<{ id: string }>("SELECT id FROM tx WHERE ended IS NULL AND deadline <= ?", Date.now())
      .toArray();
    for (const { id } of due) this.end(id, "expired");
    await this.schedule();
  }

  /** Committed Transactions after `sinceRev`, oldest first, and the current `rev`. */
  changes(sinceRev: number, limit = 100): Result<{ rev: number; changes: ChangeEntry[] }> {
    return guard(() => ({ rev: this.load().rev, changes: this.log(sinceRev, limit) }));
  }

  /** Throws REV_CONFLICT unless `ifRev` is absent or equals the committed `rev`. */
  private checkRev(doc: Document, ifRev: number | undefined) {
    if (ifRev === undefined || ifRev === doc.rev) return;
    // ponytail: unbounded when ifRev is far behind; cap the ids if a conflict ever gets large.
    const nodeIds = [
      ...new Set(
        this.log(ifRev, -1).flatMap((c) => [...c.createdIds, ...c.updatedIds, ...c.deletedIds]),
      ),
    ];
    throw new ZibelError({
      code: "REV_CONFLICT",
      message: `The Document is at rev ${doc.rev}, not ${ifRev}.`,
      hint: `Call zibel_doc_changes with sinceRev: ${ifRev} to see what changed, then retry with ifRev: ${doc.rev}.`,
      path: "ifRev",
      rev: doc.rev,
      nodeIds,
    });
  }

  /** `limit` -1 means all. */
  private log(sinceRev: number, limit: number): ChangeEntry[] {
    return this.sql
      .exec<Record<string, string | number | null>>(
        "SELECT * FROM tx_log WHERE rev > ? ORDER BY rev LIMIT ?",
        sinceRev,
        limit,
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
  }

  /** The Document as `txId` sees it, extending that Transaction's deadline; `doc` without it. */
  private view(doc: Document, actor: string, txId: string | undefined): Document {
    if (txId === undefined) return doc;
    this.openTx(txId, actor);
    return overlay(doc, this.rows(txId));
  }

  /** Resolves an open Transaction of `actor` and extends its deadline. */
  private openTx(txId: string, actor: string): { label: string | null } {
    const tx = this.sql
      .exec<{ actor: string; label: string | null; deadline: number; ended: string | null }>(
        "SELECT actor, label, deadline, ended FROM tx WHERE id = ?",
        txId,
      )
      .toArray()[0];
    if (!tx || tx.actor !== actor) {
      throw new ZibelError({
        code: "TX_NOT_FOUND",
        message: `No Transaction ${txId} of yours in this Document.`,
        hint: "Use the txId from your zibel_tx_begin on this Document, or begin a new one.",
        path: "txId",
      });
    }
    // The alarm may run late; a Transaction past its deadline is expired whether it ran or not.
    if (!tx.ended && tx.deadline <= Date.now()) {
      this.end(txId, "expired");
      tx.ended = "expired";
    }
    if (tx.ended) {
      let how: string = ENDED[tx.ended as keyof typeof ENDED];
      if (tx.ended === "committed") {
        const log = this.sql.exec<{ rev: number }>("SELECT rev FROM tx_log WHERE tx_id = ?", txId);
        how += ` at rev ${log.one().rev}`;
      }
      throw new ZibelError({
        code: "TX_EXPIRED",
        message: `Transaction ${txId} has ended.`,
        hint: `It was ${how}. Begin a new Transaction with zibel_tx_begin, or write without txId.`,
        path: "txId",
      });
    }
    this.sql.exec("UPDATE tx SET deadline = ? WHERE id = ?", Date.now() + TX_IDLE_MS, txId);
    return { label: tx.label };
  }

  private rows(txId: string): TxRow[] {
    const parse = (json: string | null) => (json === null ? null : (JSON.parse(json) as Node));
    return this.sql
      .exec<{ node_id: string; base: string | null; working: string | null }>(
        "SELECT node_id, base, working FROM tx_nodes WHERE tx_id = ? ORDER BY rowid",
        txId,
      )
      .toArray()
      .map((r) => ({ id: r.node_id, base: parse(r.base), working: parse(r.working) }));
  }

  /**
   * Records the edit in the overlay. `base` is taken from the committed Node on first touch only.
   * Call inside transactionSync.
   */
  private stage(txId: string, rev: number, change: Required<Change>) {
    const upsert = (id: string, working: string | null) =>
      this.sql.exec(
        `INSERT INTO tx_nodes (tx_id, node_id, base, working)
         VALUES (?, ?, (SELECT json FROM nodes WHERE id = ?), ?)
         ON CONFLICT (tx_id, node_id) DO UPDATE SET working = excluded.working`,
        txId,
        id,
        id,
        working,
      );
    for (const n of [...change.created, ...change.updated]) upsert(n.id, JSON.stringify(n));
    for (const id of change.deletedIds) upsert(id, null);
    return { txId, rev };
  }

  private end(txId: string, how: keyof typeof ENDED) {
    this.sql.exec("UPDATE tx SET ended = ? WHERE id = ?", how, txId);
    this.sql.exec("DELETE FROM tx_nodes WHERE tx_id = ?", txId);
  }

  /** Points the alarm at the earliest open deadline, or clears it. */
  private async schedule() {
    const { next } = this.sql
      .exec<{ next: number | null }>("SELECT MIN(deadline) AS next FROM tx WHERE ended IS NULL")
      .one();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
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
  private commit(
    actor: string,
    summary: string,
    intent: string | undefined,
    change: Change,
    txId = newId(),
  ) {
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

function summary(verb: string, { created = [], updated = [], deletedIds = [] }: Change) {
  const count = created.length + updated.length + deletedIds.length;
  return `${verb} ${count} ${count === 1 ? "Node" : "Nodes"}`;
}

function guard<T>(fn: () => T): Result<T> {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZibelError) return { error: e.data };
    throw e;
  }
}
