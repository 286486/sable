import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ArtboardInput, NodeInput, WriteReceipt, ZibelError } from "@zibel/core";
import type { DocumentService } from "@zibel/sync";
import { z } from "zod";
import { CreatedDocumentOutput, OutlineOutput, RenderOutput } from "./schemas.ts";

const docId = z.string().describe("Document id returned by zibel_doc_create.");

/** A fresh server per request: MCP is stateless (ADR-0006). */
export function createMcpServer(service: DocumentService, actor: string): McpServer {
  const server = new McpServer({ name: "zibel", version: "0.0.0" });

  /** Runs a tool handler, maps ZibelError to an error result and logs one line per call (§7.7). */
  const run = async (tool: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    const start = Date.now();
    let result: CallToolResult;
    let code: string | null = null;
    try {
      result = await fn();
    } catch (e) {
      if (!(e instanceof ZibelError)) throw e;
      code = e.data.code;
      result = { isError: true, content: [{ type: "text", text: JSON.stringify(e.data) }] };
    }
    const out = result.structuredContent ?? {};
    const ids = (k: string) => (Array.isArray(out[k]) ? out[k].length : 0);
    console.log(
      JSON.stringify({
        actor,
        tool,
        ms: Date.now() - start,
        nodes: ids("createdIds") + ids("updatedIds") + ids("deletedIds"),
        code,
        rev: typeof out.rev === "number" ? out.rev : null,
      }),
    );
    return result;
  };

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
    (args) => run("zibel_doc_create", async () => json(await service.create(args))),
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
    ({ docId, nodes }) =>
      run("zibel_node_create", async () => json(await service.createNodes(docId, nodes))),
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
    ({ docId, depth }) =>
      run("zibel_doc_outline", async () => json(await service.outline(docId, depth))),
  );

  server.registerTool(
    "zibel_render",
    {
      title: "Render",
      description:
        "Render the whole Document (every Artboard) to a PNG so you can see what you drew. viewport maps pixels back to document coordinates: docX = docRect.x + px / scale.",
      inputSchema: {
        docId,
        scale: z.number().positive().max(4).default(1).describe("Pixels per point."),
      },
      outputSchema: RenderOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, scale }) =>
      run("zibel_render", async () => {
        const { png, viewport } = await service.render(docId, scale);
        return {
          structuredContent: { viewport },
          content: [{ type: "image", data: base64(png), mimeType: "image/png" }],
        };
      }),
  );

  return server;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** A structured result plus the same JSON as text, for clients that ignore structuredContent. */
const json = (result: object): CallToolResult => ({
  structuredContent: result as Record<string, unknown>,
  content: [{ type: "text", text: JSON.stringify(result) }],
});
