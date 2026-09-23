import type {
  Artboard,
  ArtboardInput,
  ConciseView,
  FullView,
  NodeInput,
  OutlineNode,
  Rect,
  WriteReceipt,
} from "@zibel/core";

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
  create(input: { name: string; artboards: ArtboardInput[] }): Promise<CreatedDocument>;
  createNodes(docId: string, nodes: NodeInput[]): Promise<WriteReceipt>;
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
