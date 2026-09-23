import { DurableObject } from "cloudflare:workers";
import {
  type Artboard,
  type ArtboardInput,
  bounds,
  createDocument,
  createNodes,
  type Document,
  type ErrorData,
  type Node,
  type NodeInput,
  newId,
  type OutlineNode,
  outline,
  union,
  type WriteReceipt,
  ZibelError,
} from "@zibel/core";
import { toSvg } from "@zibel/render";

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
}

export interface CreatedDocument {
  docId: string;
  defaultLayerId: string;
  artboards: Artboard[];
  rev: number;
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
        created_ids TEXT NOT NULL, updated_ids TEXT NOT NULL, deleted_ids TEXT NOT NULL
      );
    `);
  }

  create(input: {
    docId: string;
    name: string;
    artboards: ArtboardInput[];
    actor: string;
  }): CreatedDocument {
    const { doc, defaultLayerId } = createDocument({
      id: input.docId,
      name: input.name,
      artboards: input.artboards,
    });
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO doc (id, name, rev, artboards) VALUES (?, ?, 0, ?)",
        doc.id,
        doc.name,
        JSON.stringify(doc.artboards),
      );
      this.commit(input.actor, `Create Document "${doc.name}"`, [...doc.nodes.values()]);
    });
    return { docId: doc.id, defaultLayerId, artboards: doc.artboards, rev: 1 };
  }

  info(): Result<{ docId: string; name: string; rev: number; artboards: Artboard[] }> {
    return guard(() => {
      const { id, name, rev, artboards } = this.load();
      return { docId: id, name, rev, artboards };
    });
  }

  createNodes(inputs: NodeInput[], actor: string): Result<WriteReceipt> {
    return guard(() => {
      const doc = this.load();
      const created = createNodes(doc, inputs);
      const noun = created.length === 1 ? "Node" : "Nodes";
      const { txId, rev } = this.ctx.storage.transactionSync(() =>
        this.commit(actor, `Create ${created.length} ${noun}`, created),
      );
      const keyMap: Record<string, string> = {};
      inputs.forEach((input, i) => {
        const id = created[i]?.id;
        if (input.clientKey && id) keyMap[input.clientKey] = id;
      });
      return {
        txId,
        rev,
        createdIds: created.map((n) => n.id),
        updatedIds: [],
        deletedIds: [],
        keyMap,
        bounds: union(created.map((n) => bounds(doc, n))),
        warnings: [],
      };
    });
  }

  outline(depth: number): Result<OutlineNode[]> {
    return guard(() => outline(this.load(), depth));
  }

  svg(): Result<string> {
    return guard(() => toSvg(this.load()));
  }

  changes(sinceRev: number): Result<ChangeEntry[]> {
    return guard(() => {
      this.load();
      return this.sql
        .exec<Record<string, string | number>>(
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

  /** Writes created Nodes, bumps `rev` once and logs the Transaction. Call inside transactionSync. */
  private commit(actor: string, summary: string, created: Node[]) {
    for (const node of created) {
      this.sql.exec("INSERT INTO nodes (id, json) VALUES (?, ?)", node.id, JSON.stringify(node));
    }
    const rev = this.sql
      .exec<{ rev: number }>("UPDATE doc SET rev = rev + 1 RETURNING rev")
      .one().rev;
    const txId = newId();
    this.sql.exec(
      "INSERT INTO tx_log VALUES (?, ?, ?, ?, ?, '[]', '[]')",
      rev,
      txId,
      actor,
      summary,
      JSON.stringify(created.map((n) => n.id)),
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
