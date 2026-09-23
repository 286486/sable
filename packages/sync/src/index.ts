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
  /** Fail with REV_CONFLICT unless the committed `rev` equals this. */
  ifRev?: number;
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
  get(
    docId: string,
    nodeIds: string[],
    detail: "concise" | "full",
  ): Promise<{ rev: number; nodes: (ConciseView | FullView)[] }>;
  outline(docId: string, depth: number): Promise<{ rev: number; layers: OutlineNode[] }>;
  render(docId: string, scale: number): Promise<{ png: Uint8Array; viewport: Viewport }>;
}

/** Maps rendered pixels back to document coordinates (F-MCP-11). */
export interface Viewport {
  docRect: Rect;
  pixelSize: { width: number; height: number };
  scale: number;
}
