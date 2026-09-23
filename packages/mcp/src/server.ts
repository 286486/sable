import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ArtboardInput,
  NodeInput,
  TransformInput,
  UpdateInput,
  WriteReceipt,
  ZibelError,
} from "@zibel/core";
import type { DocumentService } from "@zibel/sync";
import { z } from "zod";
import {
  ChangesOutput,
  CreatedDocumentOutput,
  DocInfoOutput,
  NodeGetOutput,
  OutlineOutput,
  RenderOutput,
  TxOutput,
} from "./schemas.ts";

const docId = z.string().describe("Document id returned by zibel_doc_create.");
const intent = z
  .string()
  .max(500)
  .optional()
  .describe("One sentence on what this write is for, shown to people editing the Document.");
const txId = z
  .string()
  .describe("Transaction id from zibel_tx_begin. Only the Actor that began it can use it.");
const readTxId = txId
  .optional()
  .describe("Transaction id from zibel_tx_begin: also show its uncommitted edits.");
const ifRev = z
  .number()
  .int()
  .optional()
  .describe(
    "Fail with REV_CONFLICT, changing nothing, unless the Document's committed rev equals this: set it to the rev you last read so you never overwrite someone else's newer edit.",
  );
/** Accepted by every Node write (§6.4). */
const writeFields = {
  intent,
  txId: txId
    .optional()
    .describe(
      "Transaction id from zibel_tx_begin. The write stays invisible to others until zibel_tx_commit, and the receipt's rev stays the committed rev. intent is then ignored: give it to zibel_tx_commit.",
    ),
  ifRev,
  partial: z
    .boolean()
    .default(false)
    .describe(
      "false: one bad item fails the call and changes nothing. true: apply the valid items and list the others in the receipt's failed.",
    ),
};
const coordinates =
  "A Live Shape's parameters and a path's d are in the Node's own coordinates, mapped to the Document by its transform; geometricBounds says where it is.";
const edit = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

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
        intent,
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
        "Live Shapes and paths take appearance {fills: [{color}], strokes: [{color, width, cap, join, miterLimit, dash}]}, colors #RRGGBB or #RRGGBBAA; omit it for a white Fill and a 1 pt black Stroke.",
        "Give each node a clientKey to find its new id in the receipt's keyMap.",
        "At most 2000 Nodes per call, counting inline children.",
        "Also accepts tags and meta (any JSON) on each node.",
      ].join(" "),
      inputSchema: { docId, nodes: z.array(NodeInput).min(1), ...writeFields },
      outputSchema: WriteReceipt.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, nodes, ...opts }) =>
      run("zibel_node_create", async () => json(await service.createNodes(docId, nodes, opts))),
  );

  server.registerTool(
    "zibel_node_update",
    {
      title: "Update Nodes",
      description: [
        "Change Nodes with one JSON Merge Patch (RFC 7396) each: objects merge, null deletes a key, arrays and everything else replace.",
        "Writable on every Node: name, visible, locked, opacity (0-1), blendMode (stored, not rendered yet), tags, meta. A Live Shape or path also takes its parameters (see zibel_node_create) and appearance; a path takes d.",
        "fills and strokes replace as a whole list, so send every Fill or Stroke you want to keep.",
        "Move, rotate or scale with zibel_node_transform; transform, type, parentId and derived bounds are read-only.",
        coordinates,
      ].join(" "),
      inputSchema: {
        docId,
        updates: z.array(UpdateInput).min(1).max(1000),
        ...writeFields,
      },
      outputSchema: WriteReceipt.shape,
      annotations: edit,
    },
    ({ docId, updates, ...opts }) =>
      run("zibel_node_update", async () => json(await service.updateNodes(docId, updates, opts))),
  );

  server.registerTool(
    "zibel_node_delete",
    {
      title: "Delete Nodes",
      description:
        "Delete Nodes and everything inside them. The receipt's deletedIds lists every removed id, descendants included; bounds is where they were.",
      inputSchema: {
        docId,
        nodeIds: z.array(z.string()).min(1).max(1000),
        ...writeFields,
      },
      outputSchema: WriteReceipt.shape,
      annotations: edit,
    },
    ({ docId, nodeIds, ...opts }) =>
      run("zibel_node_delete", async () => json(await service.deleteNodes(docId, nodeIds, opts))),
  );

  server.registerTool(
    "zibel_node_transform",
    {
      title: "Transform Nodes",
      description: [
        "Move, rotate, scale, skew or reflect Nodes about a reference point (the pivot, as in Illustrator's Transform panel), in document coordinates.",
        "Several parts compose as: scale, then skew, then rotate, all about the pivot, then translate. matrix [a, b, c, d, e, f] replaces rotate, skew and scale; [-1, 0, 0, 1, 0, 0] reflects across the pivot.",
        "pivot is center (default), topLeft, top, topRight, left, right, bottomLeft, bottom or bottomRight of the targets' geometricBounds, or {x, y}. With each: true every target turns about its own pivot; otherwise all share one.",
        "Transforming a Layer or Group transforms every Node inside it; updatedIds lists those Nodes. Live Shapes keep their parameters and gain a transform.",
        "scaleStrokes (default true) scales Stroke widths with the shape. The receipt's bounds are the new bounds.",
      ].join(" "),
      inputSchema: TransformInput.safeExtend({ docId, ...writeFields }),
      outputSchema: WriteReceipt.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, intent, partial, txId, ifRev, ...input }) =>
      run("zibel_node_transform", async () =>
        json(await service.transformNodes(docId, input, { intent, partial, txId, ifRev })),
      ),
  );

  server.registerTool(
    "zibel_node_get",
    {
      title: "Get Nodes",
      description: [
        "Read Nodes by id, in document coordinates.",
        "concise (default): id, type, name, parentId, visible, locked, childCount and geometricBounds.",
        "full adds every stored property (Live Shape parameters, appearance, transform, opacity, blendMode, tags, meta), the outline d and closed of a Live Shape or path, visibleBounds (including Strokes) and worldTransform.",
        coordinates,
      ].join(" "),
      inputSchema: {
        docId,
        nodeIds: z.array(z.string()).min(1).max(1000),
        detail: z.enum(["concise", "full"]).default("concise"),
        txId: readTxId,
      },
      outputSchema: NodeGetOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, nodeIds, detail, txId }) =>
      run("zibel_node_get", async () => json(await service.get(docId, nodeIds, detail, txId))),
  );

  server.registerTool(
    "zibel_doc_outline",
    {
      title: "Document outline",
      description:
        "Sparse tree of the Document: the top level is always the Layer list. Each entry has id, type, name, bounds, childCount, visible and locked; children appear down to `depth` levels.",
      inputSchema: { docId, depth: z.number().int().min(1).default(2), txId: readTxId },
      outputSchema: OutlineOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, depth, txId }) =>
      run("zibel_doc_outline", async () => json(await service.outline(docId, depth, txId))),
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
        txId: readTxId,
      },
      outputSchema: RenderOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, scale, txId }) =>
      run("zibel_render", async () => {
        const { png, viewport } = await service.render(docId, scale, txId);
        return {
          structuredContent: { viewport },
          content: [{ type: "image", data: png.toBase64(), mimeType: "image/png" }],
        };
      }),
  );

  server.registerTool(
    "zibel_doc_get_info",
    {
      title: "Document info",
      description:
        "A Document's name, Artboards, Node count, current committed rev and how many browsers have it open right now. Call it before writing to learn the rev to pass as ifRev and whether a person is watching.",
      inputSchema: { docId },
      outputSchema: DocInfoOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId }) => run("zibel_doc_get_info", async () => json(await service.info(docId))),
  );

  server.registerTool(
    "zibel_doc_changes",
    {
      title: "Document changes",
      description: [
        "What was committed after sinceRev, oldest first, by any Actor (people and Agents): each entry has rev, txId, actor, summary, intent and the created, updated and deleted Node ids. rev is the Document's current committed rev.",
        "Call it before a round of writes to see what a person changed since your last read, then pass that rev as ifRev.",
      ].join(" "),
      inputSchema: {
        docId,
        sinceRev: z.number().int().min(0),
        limit: z.number().int().min(1).max(1000).default(100),
      },
      outputSchema: ChangesOutput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ docId, sinceRev, limit }) =>
      run("zibel_doc_changes", async () => json(await service.changes(docId, sinceRev, limit))),
  );

  server.registerTool(
    "zibel_tx_begin",
    {
      title: "Begin Transaction",
      description: [
        "Start a Transaction to make several writes one step that people see, and undo, at once.",
        "Pass the returned txId to each write, and to node_get, doc_outline and render to see your uncommitted work; nobody else sees it until zibel_tx_commit.",
        "It rolls back after 5 minutes without a call carrying its txId. label becomes the summary in zibel_doc_changes. rev is the committed rev, for ifRev.",
      ].join(" "),
      inputSchema: { docId, label: z.string().min(1).max(200).optional() },
      outputSchema: TxOutput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, label }) =>
      run("zibel_tx_begin", async () => json(await service.begin(docId, label))),
  );

  server.registerTool(
    "zibel_tx_commit",
    {
      title: "Commit Transaction",
      description: [
        "Apply every write of the Transaction at once: rev goes up by one and the receipt lists every created, updated and deleted id.",
        "Properties someone else changed meanwhile are kept unless the Transaction changed the same property. If someone deleted a Node the Transaction edited, or a Layer or Group it created Nodes in, the commit fails with NODE_GONE listing them and the Transaction stays open for zibel_tx_rollback.",
      ].join(" "),
      inputSchema: { docId, txId, ifRev, intent },
      outputSchema: WriteReceipt.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, txId, ifRev, intent }) =>
      run("zibel_tx_commit", async () =>
        json(await service.commitTx(docId, txId, { ifRev, intent })),
      ),
  );

  server.registerTool(
    "zibel_tx_rollback",
    {
      title: "Roll back Transaction",
      description:
        "Discard every uncommitted write of the Transaction; the Document stays as it is committed. Later calls with the txId return TX_EXPIRED.",
      inputSchema: { docId, txId },
      outputSchema: TxOutput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ docId, txId }) =>
      run("zibel_tx_rollback", async () => json(await service.rollback(docId, txId))),
  );

  return server;
}

/** A structured result plus the same JSON as text, for clients that ignore structuredContent. */
const json = (result: object): CallToolResult => ({
  structuredContent: result as Record<string, unknown>,
  content: [{ type: "text", text: JSON.stringify(result) }],
});
