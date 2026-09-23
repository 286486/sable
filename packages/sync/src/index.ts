export * from "./protocol.ts";

import type {
  Artboard,
  ArtboardInput,
  ConciseView,
  FullView,
  NodeInput,
  OutlineNode,
  Rect,
  TransformInput,
  UpdateInput,
  WriteReceipt,
} from "@zibel/core";

/** Accepted by every write. `intent` is stored with the Transaction (F-COLLAB-04). */
export interface WriteOptions {
  intent?: string;
  /** Apply the valid items and report the rest in the receipt's `failed` (F-MCP-16). */
  partial?: boolean;
  /** Stage the write in this open Transaction instead of committing it (ADR-0008). */
  txId?: string;
  /** Fail with REV_CONFLICT unless the committed `rev` equals this. */
  ifRev?: number;
}

/** One committed Transaction, as `doc_changes` lists it (F-MCP-14). */
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

export interface CreatedDocument {
  docId: string;
  defaultLayerId: string;
  artboards: Artboard[];
  rev: number;
}

/**
 * What the MCP tools (and later the browser) need from a Document, for one Actor.
 * Failures reject with a `ZibelError`.
 */
export interface DocumentService {
  create(input: {
    name: string;
    artboards: ArtboardInput[];
    intent?: string;
  }): Promise<CreatedDocument>;
  createNodes(docId: string, nodes: NodeInput[], opts?: WriteOptions): Promise<WriteReceipt>;
  updateNodes(docId: string, updates: UpdateInput[], opts?: WriteOptions): Promise<WriteReceipt>;
  deleteNodes(docId: string, nodeIds: string[], opts?: WriteOptions): Promise<WriteReceipt>;
  transformNodes(docId: string, input: TransformInput, opts?: WriteOptions): Promise<WriteReceipt>;
  /** Reads take `txId` to see that open Transaction's uncommitted edits. */
  get(
    docId: string,
    nodeIds: string[],
    detail: "concise" | "full",
    txId?: string,
  ): Promise<{ rev: number; nodes: (ConciseView | FullView)[] }>;
  outline(
    docId: string,
    depth: number,
    txId?: string,
  ): Promise<{ rev: number; layers: OutlineNode[] }>;
  render(
    docId: string,
    scale: number,
    txId?: string,
  ): Promise<{ png: Uint8Array; viewport: Viewport }>;
  begin(docId: string, label?: string): Promise<{ txId: string; rev: number }>;
  commitTx(
    docId: string,
    txId: string,
    opts?: { ifRev?: number; intent?: string },
  ): Promise<WriteReceipt>;
  rollback(docId: string, txId: string): Promise<{ txId: string; rev: number }>;
  changes(
    docId: string,
    sinceRev: number,
    limit?: number,
  ): Promise<{ rev: number; changes: ChangeEntry[] }>;
}

/** Maps rendered pixels back to document coordinates (F-MCP-11). */
export interface Viewport {
  docRect: Rect;
  pixelSize: { width: number; height: number };
  scale: number;
}
