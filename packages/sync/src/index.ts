import type { Artboard, ArtboardInput, NodeInput, OutlineNode, WriteReceipt } from "@zibel/core";

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
  outline(docId: string, depth: number): Promise<{ rev: number; layers: OutlineNode[] }>;
}
