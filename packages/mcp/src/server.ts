import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ArtboardInput, NodeInput, WriteReceipt, ZibelError } from "@zibel/core";
import type { DocumentService } from "@zibel/sync";
import { z } from "zod";
import { CreatedDocumentOutput, NodeGetOutput, OutlineOutput, RenderOutput } from "./schemas.ts";

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
        artboards: z.array(ArtboardInput).min(1).max(1000),
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
      description: [
        "Create Nodes in one atomic write: one bad item fails the call and creates nothing.",
        "Each node needs parentId, the id of a Layer or Group, never an Artboard; a layer omits it to sit at the Document root.",
        "Types, in document coordinates (pt, origin top-left, y down):",
        "layer {name}: parent is the root or another Layer.",
        "group {children}: children are nodes of any type but layer, without parentId, created inside the Group.",
        "rect {x, y, width, height, radius}: radius is the corner radius.",
        "ellipse {x, y, width, height}: its bounding box.",
        "line {x1, y1, x2, y2}.",
        "polygon {cx, cy, radius, sides}: radius is center to vertex.",
        "star {cx, cy, outerRadius, innerRadius, points}.",
        "path {d}: SVG path data with absolute M, L, C, Q and Z only.",
        "Shapes take appearance {fills: [{color}], strokes: [{color, width, cap, join, miterLimit, dash}]}, colors #RRGGBB or #RRGGBBAA; omit it for a white Fill and a 1 pt black Stroke.",
        "Give each node a clientKey to find its new id in the receipt's keyMap.",
      ].join(" "),
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
    "zibel_node_get",
    {
      title: "Get Nodes",
      description: [
        "Read Nodes by id, in document coordinates.",
        "concise (default): id, type, name, parentId, visible, locked, childCount and geometricBounds.",
        "full adds every stored property (Live Shape parameters, appearance, transform, opacity, blendMode, tags, meta), the derived outline d of a shape or path, visibleBounds (including Strokes) and worldTransform.",
      ].join(" "),
      inputSchema: {
        docId,
        nodeIds: z.array(z.string()).min(1).max(1000),
        detail: z.enum(["concise", "full"]).default("concise"),
      },
      outputSchema: NodeGetOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, nodeIds, detail }) =>
      run("zibel_node_get", async () => json(await service.get(docId, nodeIds, detail))),
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
          content: [{ type: "image", data: png.toBase64(), mimeType: "image/png" }],
        };
      }),
  );

  return server;
}

/** A structured result plus the same JSON as text, for clients that ignore structuredContent. */
const json = (result: object): CallToolResult => ({
  structuredContent: result as Record<string, unknown>,
  content: [{ type: "text", text: JSON.stringify(result) }],
});
