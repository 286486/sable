import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ArtboardInput, NodeInput, WriteReceipt, ZibelError } from "@zibel/core";
import type { DocumentService } from "@zibel/sync";
import { z } from "zod";
import { CreatedDocumentOutput, OutlineOutput } from "./schemas.ts";

const docId = z.string().describe("Document id returned by zibel_doc_create.");

/** A fresh server per request: MCP is stateless (ADR-0006). */
export function createMcpServer(service: DocumentService): McpServer {
  const server = new McpServer({ name: "zibel", version: "0.0.0" });

  server.registerTool(
    "zibel_doc_create",
    {
      title: "Create Document",
      description:
        "Create a Document with one or more Artboards. Returns docId and the id of its default Layer, which is the parent for your first Nodes. Coordinates are document points, origin top-left, y down.",
      inputSchema: {
        name: z.string().min(1),
        artboards: z.array(ArtboardInput).min(1),
      },
      outputSchema: CreatedDocumentOutput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) => run(() => service.create(args)),
  );

  server.registerTool(
    "zibel_node_create",
    {
      title: "Create Nodes",
      description:
        "Create Nodes in one atomic write. Each node needs parentId, the id of a Layer or Group (never an Artboard). Only rect is supported for now: x, y, width, height in document coordinates, optional appearance {fills: [{color}], strokes: [{color, width}]} with colors as #RRGGBB or #RRGGBBAA.",
      inputSchema: { docId, nodes: z.array(NodeInput).min(1).max(2000) },
      outputSchema: WriteReceipt.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, nodes }) => run(() => service.createNodes(docId, nodes)),
  );

  server.registerTool(
    "zibel_doc_outline",
    {
      title: "Document outline",
      description:
        "Sparse tree of the Document: the top level is always the Layer list. Each entry has id, type, name, bounds, childCount, visible and locked; children appear down to `depth` levels.",
      inputSchema: { docId, depth: z.number().int().min(1).default(2) },
      outputSchema: OutlineOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, depth }) => run(() => service.outline(docId, depth)),
  );

  return server;
}

/** Wraps a structured result, or turns a ZibelError into an error result the Agent can act on. */
async function run(fn: () => Promise<object>): Promise<CallToolResult> {
  try {
    const result = await fn();
    return {
      structuredContent: result as Record<string, unknown>,
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (e) {
    if (!(e instanceof ZibelError)) throw e;
    return { isError: true, content: [{ type: "text", text: JSON.stringify(e.data) }] };
  }
}
