import { DurableObject } from "cloudflare:workers";
import { type ErrorData, ZibelError } from "@zibel/core";

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

interface CreateInput {
  docId: string;
  name: string;
  artboards: unknown[];
  actor: string;
}

/** The authoritative store for one Document (ADR-0003). Every call reads SQLite; nothing is cached. */
export class DocumentObject extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS doc (id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, artboards TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tx_log (
        rev INTEGER PRIMARY KEY, tx_id TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL,
        created_ids TEXT NOT NULL, updated_ids TEXT NOT NULL, deleted_ids TEXT NOT NULL
      );
    `);
  }

  create(input: CreateInput): Result<{ docId: string; rev: number }> {
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO doc (id, name, rev, artboards) VALUES (?, ?, 1, ?)",
        input.docId,
        input.name,
        JSON.stringify(input.artboards),
      );
      this.log({
        rev: 1,
        txId: crypto.randomUUID(),
        actor: input.actor,
        summary: `Create Document "${input.name}"`,
        createdIds: [],
        updatedIds: [],
        deletedIds: [],
      });
      return { docId: input.docId, rev: 1 };
    });
  }

  info(): Result<{ docId: string; name: string; rev: number; artboards: unknown[] }> {
    return guard(() => {
      const row = this.docRow();
      return { docId: row.id, name: row.name, rev: row.rev, artboards: JSON.parse(row.artboards) };
    });
  }

  changes(sinceRev: number): Result<ChangeEntry[]> {
    return guard(() => {
      this.docRow();
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

  private docRow() {
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
    return row;
  }

  private log(e: ChangeEntry) {
    this.sql.exec(
      "INSERT INTO tx_log VALUES (?, ?, ?, ?, ?, ?, ?)",
      e.rev,
      e.txId,
      e.actor,
      e.summary,
      JSON.stringify(e.createdIds),
      JSON.stringify(e.updatedIds),
      JSON.stringify(e.deletedIds),
    );
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
