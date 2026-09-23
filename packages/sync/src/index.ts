export * from "./protocol.ts";

import type {
  Artboard,
  ArtboardInput,
  ConciseView,
  FullView,
  NodeInput,
  OutlineNode,
  Overlay,
  Rect,
  RenderScope,
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

export interface DocInfo {
  docId: string;
  name: string;
  artboards: Artboard[];
  nodeCount: number;
  rev: number;
  /** Browsers subscribed over WebSocket right now (ADR-0009). */
  browsers: number;
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
  info(docId: string): Promise<DocInfo>;
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
  /** A PNG of the scope, and the Viewport mapping its pixels back (ADR-0014). */
  render(docId: string, req: RasterRequest): Promise<{ png: Uint8Array; viewport: Viewport }>;
  /** The SVG of the scope, the artwork only. */
  svg(docId: string, req: RenderRequest): Promise<{ svg: string; docRect: Rect }>;
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

/** What `render` and `export` draw (ADR-0014). */
export interface RenderRequest {
  /** Omitted: the whole Document, every Artboard. */
  scope?: RenderScope;
  /** A parsed `#RRGGBB` or `#RRGGBBAA` filling the whole scope beneath everything. */
  background?: string;
  /** See this open Transaction's uncommitted edits. */
  txId?: string;
}

export interface RasterRequest extends RenderRequest {
  /** Pixels per point. */
  scale: number;
  /** Lower `scale` until the longer side is at most this many pixels. */
  maxSize?: number;
  overlays?: Overlay[];
}

/** Maps rendered pixels back to document coordinates (F-MCP-11). */
export interface Viewport {
  docRect: Rect;
  pixelSize: { width: number; height: number };
  scale: number;
}
