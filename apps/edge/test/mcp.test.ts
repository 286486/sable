import { evictAllDurableObjects, runDurableObjectAlarm } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { COLOR_PATTERN, type ErrorCode } from "@zibel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/documents/inkscape.zibel.json?raw";
import exported from "./fixtures/inkscape.svg?raw";
import { call, errorOf, rpc } from "./rpc.ts";

const newDoc = async () =>
  (await call("zibel_doc_create", { name: "Doc", artboards: [{ width: 200, height: 100 }] }))
    .structuredContent;

it("initializes without a session id", async () => {
  const { res, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  expect(body.result.serverInfo.name).toBe("zibel");
  expect(res.headers.get("mcp-session-id")).toBeNull();
});

it("lists tools with annotations and an outputSchema", async () => {
  const { body } = await rpc("tools/list");
  const tools = body.result.tools as {
    name: string;
    annotations: object;
    inputSchema: object;
    outputSchema: object;
  }[];
  expect(tools.map((t) => t.name).sort()).toEqual([
    "zibel_doc_changes",
    "zibel_doc_create",
    "zibel_doc_get_info",
    "zibel_doc_list",
    "zibel_doc_open",
    "zibel_doc_outline",
    "zibel_export",
    "zibel_node_create",
    "zibel_node_delete",
    "zibel_node_get",
    "zibel_node_query",
    "zibel_node_transform",
    "zibel_node_update",
    "zibel_render",
    "zibel_tx_begin",
    "zibel_tx_commit",
    "zibel_tx_rollback",
  ]);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const inputKeys = (name: string) => {
    const tool = byName[name];
    return tool ? Object.keys((tool.inputSchema as { properties: object }).properties) : [];
  };
  for (const [name, destructive] of [
    ["zibel_node_create", false],
    ["zibel_node_update", true],
    ["zibel_node_delete", true],
    ["zibel_node_transform", false],
  ] as const) {
    expect(byName[name]?.annotations).toMatchObject({ destructiveHint: destructive });
    expect(inputKeys(name)).toEqual(
      expect.arrayContaining(["docId", "intent", "txId", "ifRev", "partial"]),
    );
  }
  expect(inputKeys("zibel_doc_create")).toContain("intent");
  for (const name of [
    "zibel_node_get",
    "zibel_node_query",
    "zibel_doc_outline",
    "zibel_render",
    "zibel_export",
  ]) {
    expect(inputKeys(name)).toContain("txId");
  }
  expect(inputKeys("zibel_tx_commit")).toEqual(
    expect.arrayContaining(["docId", "txId", "ifRev", "intent"]),
  );
  expect(byName.zibel_doc_changes?.annotations).toMatchObject({ readOnlyHint: true });
  expect(byName.zibel_doc_get_info?.annotations).toMatchObject({ readOnlyHint: true });
  expect(byName.zibel_doc_list?.annotations).toMatchObject({ readOnlyHint: true });
  expect(byName.zibel_tx_rollback?.annotations).toMatchObject({ destructiveHint: true });
  expect(byName.zibel_tx_commit?.annotations).toMatchObject({ destructiveHint: false });
  expect(JSON.stringify(tools)).not.toContain("no effect yet");
  // Descriptions point at the Skill document instead of repeating its conventions.
  const described = (name: string) => (byName[name] as { description?: string })?.description;
  for (const name of ["zibel_doc_create", "zibel_node_create", "zibel_node_update"]) {
    expect(described(name)).toContain("skill://zibel/drawing-conventions");
  }
  expect(described("zibel_node_create")).not.toContain("origin top-left");
  for (const t of tools) {
    expect(t.annotations, t.name).toEqual({
      readOnlyHint: expect.any(Boolean),
      destructiveHint: expect.any(Boolean),
      idempotentHint: expect.any(Boolean),
      openWorldHint: false,
    });
    expect(t.outputSchema, t.name).toMatchObject({ type: "object" });
  }
  // Core validates colours, but Agents still read the pattern from the published schema (§6.5).
  const nodeCreate = tools.find((t) => t.name === "zibel_node_create");
  expect(JSON.stringify(nodeCreate?.inputSchema)).toContain(
    JSON.stringify({ type: "string", pattern: COLOR_PATTERN }).slice(1, -1),
  );
});

// #4: Point Type measured by Source Sans 3's advances, read straight from the TTF: H 652, i 246,
// space 200 per 1000 units; ascender 1000, descender -326.
it("creates text whose bounds grow with its content by the font's advance widths", async () => {
  const doc = await newDoc();
  const text = (content: string) => ({
    type: "text",
    parentId: doc.defaultLayerId,
    x: 10,
    y: 50,
    content,
  });
  const { tools } = (await rpc("tools/list")).body.result as {
    tools: { name: string; description: string }[];
  };
  expect(tools.find((t) => t.name === "zibel_node_create")?.description).toContain("text {");
  const created = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [text("Hi"), text("Hi Hi")],
  });
  const ids = created.structuredContent.createdIds as string[];
  const bounds = async () =>
    (
      (await call("zibel_node_get", { docId: doc.docId, nodeIds: ids })).structuredContent
        .nodes as { geometricBounds: { x: number; y: number; width: number; height: number } }[]
    ).map((n) => n.geometricBounds);
  const [hi, longer] = await bounds();
  expect(hi?.x).toBeCloseTo(10);
  expect(hi?.y).toBeCloseTo(50 - 12);
  expect(hi?.width).toBeCloseTo(((652 + 246) * 12) / 1000);
  expect(hi?.height).toBeCloseTo((1326 * 12) / 1000);
  expect(longer?.width).toBeCloseTo((((652 + 246) * 2 + 200) * 12) / 1000);

  await call("zibel_node_update", {
    docId: doc.docId,
    updates: [{ nodeId: ids[0], patch: { content: "H" } }],
  });
  expect((await bounds())[0]?.width).toBeCloseTo((652 * 12) / 1000);
  const [full] = (await call("zibel_node_get", { docId: doc.docId, nodeIds: ids, detail: "full" }))
    .structuredContent.nodes;
  expect(full).toMatchObject({ type: "text", kind: "point", content: "H", fontSize: 12 });
  expect(full).not.toHaveProperty("d");
  const { nodes } = (await call("zibel_doc_outline", { docId: doc.docId })).structuredContent;
  expect(nodes[0].children.map((c: { type: string }) => c.type)).toEqual(["text", "text"]);
  const rendered = await call("zibel_render", { docId: doc.docId });
  expect(rendered.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
});

it("keeps a font Zibel lacks, warns FONT_MISSING and renders it in Source Sans 3", async () => {
  const doc = await newDoc();
  const created = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [
      {
        type: "text",
        parentId: doc.defaultLayerId,
        x: 10,
        y: 50,
        content: "Hi",
        fontFamily: "Helvetica",
      },
    ],
  });
  const [id] = created.structuredContent.createdIds as string[];
  expect(created.structuredContent.warnings).toEqual([
    expect.objectContaining({ code: "FONT_MISSING", nodeId: id }),
  ]);
  const updated = await call("zibel_node_update", {
    docId: doc.docId,
    updates: [{ nodeId: id, patch: { content: "Ho" } }],
  });
  expect(updated.structuredContent.warnings).toEqual([
    expect.objectContaining({ code: "FONT_MISSING", nodeId: id }),
  ]);
  const [full] = (await call("zibel_node_get", { docId: doc.docId, nodeIds: [id], detail: "full" }))
    .structuredContent.nodes;
  expect(full).toMatchObject({ fontFamily: "Helvetica" });
  const svg = await call("zibel_export", { docId: doc.docId, format: "svg" });
  expect(svg.content[0].text).toContain('font-family="Helvetica"');
  const rendered = await call("zibel_render", { docId: doc.docId });
  expect(rendered.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
});

it("creates a rect in the default Layer and reads it back from doc_outline", async () => {
  const doc = await newDoc();
  expect(doc).toMatchObject({
    docId: expect.any(String),
    defaultLayerId: expect.any(String),
    rev: 1,
  });

  const created = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [{ type: "rect", parentId: doc.defaultLayerId, x: 10, y: 10, width: 50, height: 30 }],
  });
  expect(created.structuredContent).toMatchObject({
    rev: 2,
    bounds: { x: 10, y: 10, width: 50, height: 30 },
  });
  const [rectId] = created.structuredContent.createdIds;

  const read = async () =>
    (await call("zibel_doc_outline", { docId: doc.docId })).structuredContent;
  const expected = {
    rev: 2,
    nodes: [
      {
        id: doc.defaultLayerId,
        type: "layer",
        children: [{ id: rectId, type: "rect", bounds: { x: 10, y: 10, width: 50, height: 30 } }],
      },
    ],
  };
  expect(await read()).toMatchObject(expected);

  await evictAllDurableObjects();
  expect(await read()).toMatchObject(expected);
});

it("reads Nodes back with node_get in concise or full detail", async () => {
  const doc = await newDoc();
  const created = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [
      {
        type: "rect",
        parentId: doc.defaultLayerId,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        appearance: { strokes: [{ color: "#000000", width: 4 }] },
      },
    ],
  });
  const [id] = created.structuredContent.createdIds;
  const get = async (detail?: string) =>
    (await call("zibel_node_get", { docId: doc.docId, nodeIds: [id], detail })).structuredContent;

  expect(await get("full")).toEqual({
    rev: 2,
    nodes: [
      expect.objectContaining({
        id,
        type: "rect",
        parentId: doc.defaultLayerId,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        radius: 0,
        d: "M 10 10 L 60 10 L 60 40 L 10 40 Z",
        appearance: {
          fills: [],
          strokes: [
            { color: "#000000", width: 4, cap: "butt", join: "miter", miterLimit: 10, dash: [] },
          ],
        },
        geometricBounds: { x: 10, y: 10, width: 50, height: 30 },
        visibleBounds: { x: 8, y: 8, width: 54, height: 34 },
        worldTransform: [1, 0, 0, 1, 0, 0],
      }),
    ],
  });
  const concise = await get();
  expect(concise.nodes[0]).toMatchObject({ id, geometricBounds: { x: 10 } });
  expect(concise.nodes[0]).not.toHaveProperty("d");
});

it("returns NODE_NOT_FOUND from node_get with the index of the unknown id", async () => {
  const doc = await newDoc();
  const result = await call("zibel_node_get", {
    docId: doc.docId,
    nodeIds: [doc.defaultLayerId, "nope"],
  });
  expect(errorOf(result)).toMatchObject({
    code: "NODE_NOT_FOUND",
    hint: expect.any(String),
    path: "nodeIds[1]",
  });
});

it("returns INVALID_PARENT with a path when the parent is a rect", async () => {
  const doc = await newDoc();
  const rect = { type: "rect", parentId: doc.defaultLayerId, x: 0, y: 0, width: 1, height: 1 };
  const first = await call("zibel_node_create", { docId: doc.docId, nodes: [rect] });
  const result = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [{ ...rect, parentId: first.structuredContent.createdIds[0] }],
  });
  expect(errorOf(result)).toMatchObject({
    code: "INVALID_PARENT",
    hint: expect.any(String),
    path: "nodes[0].parentId",
  });
});

it("returns INVALID_COLOR with a hint for a bad Artboard background", async () => {
  const result = await call("zibel_doc_create", {
    name: "Doc",
    artboards: [{ width: 10, height: 10, background: "white" }],
  });
  expect(errorOf(result)).toMatchObject({
    code: "INVALID_COLOR",
    hint: expect.stringContaining("#FFFFFF"),
    path: "artboards[0].background",
  });
});

it("returns DOC_NOT_FOUND for an unknown docId", async () => {
  for (const tool of ["zibel_doc_outline", "zibel_doc_get_info", "zibel_node_query"]) {
    const result = await call(tool, { docId: "01NOPE" });
    expect(errorOf(result)).toMatchObject({ code: "DOC_NOT_FOUND", hint: expect.any(String) });
  }
});

it("lists Documents created in earlier requests, newest first, with doc_list", async () => {
  const create = async (name: string) =>
    (await call("zibel_doc_create", { name, artboards: [{ width: 10, height: 10 }] }))
      .structuredContent.docId;
  const first = await create("First");
  const second = await create("Second");
  const { documents } = (await call("zibel_doc_list", {})).structuredContent;
  expect(documents.slice(0, 2)).toEqual([
    { docId: second, name: "Second", createdAt: expect.any(String) },
    { docId: first, name: "First", createdAt: expect.any(String) },
  ]);
});

it("reports name, Artboards, node count, rev and no browsers with doc_get_info", async () => {
  const { docId, defaultLayerId, artboards } = await newDoc();
  await call("zibel_node_create", {
    docId,
    nodes: [{ type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 10, height: 10 }],
  });
  const result = await call("zibel_doc_get_info", { docId });
  expect(result.structuredContent).toEqual({
    docId,
    name: "Doc",
    artboards,
    nodeCount: 2,
    rev: 2,
    browsers: 0,
  });
});

it("answers GET and DELETE with 405: no standalone stream and no sessions (ADR-0006)", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await exports.default.fetch("http://zibel/mcp", {
      method,
      headers: { accept: "text/event-stream", authorization: "Bearer dev-token-a" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  }
});

it("rejects more than 1000 Artboards or 2000 nodes in one call", async () => {
  const tooManyArtboards = await call("zibel_doc_create", {
    name: "x",
    artboards: Array(1001).fill({ width: 1, height: 1 }),
  });
  expect(tooManyArtboards.isError).toBe(true);
  const doc = await newDoc();
  const rect = { type: "rect", parentId: doc.defaultLayerId, x: 0, y: 0, width: 1, height: 1 };
  const tooManyNodes = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: Array(2001).fill(rect),
  });
  expect(errorOf(tooManyNodes)).toMatchObject({
    code: "LIMIT_EXCEEDED",
    hint: expect.stringContaining("Split"),
    path: "nodes",
  });
});

it("creates every M0 type with an Appearance and reads each back in full", async () => {
  const doc = await newDoc();
  const paint = (color: string) => ({
    fills: [{ color }],
    strokes: [{ color: "#000000", width: 2, join: "round" }],
  });
  const parentId = doc.defaultLayerId;
  const created = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [
      { type: "layer", clientKey: "layer", name: "Top" },
      {
        type: "group",
        parentId,
        clientKey: "group",
        children: [
          {
            type: "rect",
            clientKey: "rect",
            x: 10,
            y: 10,
            width: 40,
            height: 20,
            radius: 4,
            appearance: paint("#FF0000"),
          },
          {
            type: "line",
            clientKey: "line",
            x1: 10,
            y1: 40,
            x2: 50,
            y2: 60,
            appearance: paint("#00FF00"),
          },
        ],
      },
      {
        type: "ellipse",
        parentId,
        clientKey: "ellipse",
        x: 60,
        y: 10,
        width: 30,
        height: 20,
        appearance: paint("#0000FF"),
      },
      {
        type: "polygon",
        parentId,
        clientKey: "polygon",
        cx: 120,
        cy: 25,
        radius: 15,
        sides: 6,
        appearance: paint("#FFFF00"),
      },
      {
        type: "star",
        parentId,
        clientKey: "star",
        cx: 160,
        cy: 25,
        outerRadius: 15,
        innerRadius: 6,
        points: 5,
        appearance: paint("#FF00FF"),
      },
      {
        type: "path",
        parentId,
        clientKey: "path",
        d: "M 60 50 C 70 30 90 30 100 50 Q 80 90 60 50 Z",
        appearance: paint("#00FFFF80"),
      },
    ],
  });
  const receipt = created.structuredContent;
  const order = ["layer", "group", "rect", "line", "ellipse", "polygon", "star", "path"];
  expect(receipt.createdIds).toEqual(order.map((k) => receipt.keyMap[k]));
  expect(Object.keys(receipt.keyMap).sort()).toEqual([...order].sort());

  const { nodes } = (
    await call("zibel_node_get", { docId: doc.docId, nodeIds: receipt.createdIds, detail: "full" })
  ).structuredContent;
  const byKey = Object.fromEntries(order.map((k, i) => [k, nodes[i]]));
  expect(byKey.layer).toMatchObject({ type: "layer", name: "Top", parentId: null, childCount: 0 });
  expect(byKey.group).toMatchObject({
    type: "group",
    parentId,
    childCount: 2,
    geometricBounds: { x: 10, y: 10, width: 40, height: 50 },
    visibleBounds: { x: 9, y: 9, width: 42, height: 52 },
  });
  expect(byKey.rect).toMatchObject({
    parentId: receipt.keyMap.group,
    radius: 4,
    d: expect.stringMatching(/^M 14 10 L 46 10 C/),
    appearance: { fills: [{ type: "solid", color: "#FF0000" }], strokes: [{ join: "round" }] },
    geometricBounds: { x: 10, y: 10, width: 40, height: 20 },
  });
  expect(byKey.line).toMatchObject({
    d: "M 10 40 L 50 60",
    geometricBounds: { x: 10, y: 40, width: 40, height: 20 },
  });
  expect(byKey.ellipse).toMatchObject({
    d: expect.stringMatching(/^M 75 10 C/),
    geometricBounds: { x: 60, y: 10, width: 30, height: 20 },
  });
  expect(byKey.polygon).toMatchObject({ sides: 6, d: expect.stringMatching(/^M 120 10 L/) });
  expect(byKey.polygon.geometricBounds.height).toBeCloseTo(30, 9);
  expect(byKey.star).toMatchObject({ points: 5, d: expect.stringMatching(/^M 160 10 L/) });
  expect(byKey.star.d.match(/L/g)).toHaveLength(9);
  expect(byKey.path).toMatchObject({
    d: "M 60 50 C 70 30 90 30 100 50 Q 80 90 60 50 Z",
    appearance: { fills: [{ color: "#00FFFF80" }] },
    geometricBounds: { x: 60, y: 35, width: 40, height: 35 },
  });

  const rendered = await call("zibel_render", { docId: doc.docId });
  expect(rendered.content.find((c: { type: string }) => c.type === "image")?.mimeType).toBe(
    "image/png",
  );
});

it.each([
  [
    "INVALID_COLOR",
    (parentId: string) => ({
      type: "ellipse",
      parentId,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      appearance: { fills: [{ color: "rgb(255, 0, 0)" }] },
    }),
    "nodes[1].appearance.fills[0].color",
  ],
  [
    "INVALID_PATH",
    (parentId: string) => ({ type: "path", parentId, d: "M 0 0 h 10" }),
    "nodes[1].d",
  ],
  [
    "INVALID_PARENT",
    (parentId: string) => ({ type: "rect", parentId, x: 0, y: 0, width: 1, height: 1 }),
    "nodes[1].parentId",
  ],
] as const)("returns %s with hint and path, and creates nothing", async (code, bad, path) => {
  const doc = await newDoc();
  // The INVALID_PARENT case points at an Artboard; the others at the default Layer.
  const artboardId = doc.artboards[0].id;
  const second = bad(code === "INVALID_PARENT" ? artboardId : doc.defaultLayerId);
  const ok = { type: "line", parentId: doc.defaultLayerId, x1: 0, y1: 0, x2: 1, y2: 1 };
  const result = await call("zibel_node_create", { docId: doc.docId, nodes: [ok, second] });
  expect(errorOf(result)).toMatchObject({ code, hint: expect.any(String), path });
  const outline = (await call("zibel_doc_outline", { docId: doc.docId })).structuredContent;
  expect(outline).toMatchObject({ rev: 1, nodes: [{ childCount: 0 }] });
});

it("returns INVALID_PARENT for a Layer inside a Group", async () => {
  const doc = await newDoc();
  const group = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [{ type: "group", parentId: doc.defaultLayerId }],
  });
  const result = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [{ type: "layer", parentId: group.structuredContent.createdIds[0] }],
  });
  expect(errorOf(result)).toMatchObject({
    code: "INVALID_PARENT",
    hint: expect.any(String),
    path: "nodes[0].parentId",
  });
  const inline = await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [{ type: "group", parentId: doc.defaultLayerId, children: [{ type: "layer" }] }],
  });
  expect(errorOf(inline)).toMatchObject({
    code: "INVALID_PARENT",
    hint: expect.any(String),
    path: "nodes[0].children[0].type",
  });
});

describe("edit tools", () => {
  const setup = async () => {
    const doc = await newDoc();
    const make = async (nodes: object[]) =>
      (await call("zibel_node_create", { docId: doc.docId, nodes })).structuredContent;
    const full = async (id: string) =>
      (await call("zibel_node_get", { docId: doc.docId, nodeIds: [id], detail: "full" }))
        .structuredContent.nodes[0];
    const rect = {
      type: "rect",
      parentId: doc.defaultLayerId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    };
    return { doc, make, full, rect };
  };

  it("updates, transforms and deletes a rect, with every receipt field", async () => {
    const { doc, make, full, rect } = await setup();
    const [id] = (await make([rect])).createdIds;

    const updated = await call("zibel_node_update", {
      docId: doc.docId,
      updates: [
        { nodeId: id, patch: { name: "Box", appearance: { fills: [{ color: "#FF0000" }] } } },
      ],
    });
    expect(updated.structuredContent).toEqual({
      txId: expect.any(String),
      rev: 3,
      createdIds: [],
      updatedIds: [id],
      deletedIds: [],
      keyMap: {},
      bounds: { x: 10, y: 10, width: 50, height: 30 },
      warnings: [],
    });
    expect(await full(id)).toMatchObject({
      name: "Box",
      appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#000000", width: 1 }] },
    });

    const turned = await call("zibel_node_transform", {
      docId: doc.docId,
      nodeIds: [id],
      rotate: 90,
    });
    expect(turned.structuredContent).toEqual({
      txId: expect.any(String),
      rev: 4,
      createdIds: [],
      updatedIds: [id],
      deletedIds: [],
      keyMap: {},
      bounds: { x: 20, y: 0, width: 30, height: 50 },
      warnings: [],
    });
    expect(await full(id)).toMatchObject({
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      transform: [0, 1, -1, 0, 60, -10],
      worldTransform: [0, 1, -1, 0, 60, -10],
      geometricBounds: { x: 20, y: 0, width: 30, height: 50 },
    });
    const rendered = await call("zibel_render", { docId: doc.docId });
    expect(rendered.content.find((c: { type: string }) => c.type === "image")?.mimeType).toBe(
      "image/png",
    );

    const deleted = await call("zibel_node_delete", { docId: doc.docId, nodeIds: [id] });
    expect(deleted.structuredContent).toEqual({
      txId: expect.any(String),
      rev: 5,
      createdIds: [],
      updatedIds: [],
      deletedIds: [id],
      keyMap: {},
      bounds: { x: 20, y: 0, width: 30, height: 50 },
      warnings: [],
    });
  });

  it("never lets schema defaults into a patch", async () => {
    const { doc, make, full, rect } = await setup();
    const [id] = (await make([{ ...rect, radius: 8 }])).createdIds;
    await call("zibel_node_update", {
      docId: doc.docId,
      updates: [{ nodeId: id, patch: { width: 60 } }],
    });
    expect(await full(id)).toMatchObject({ width: 60, radius: 8 });
    await call("zibel_node_update", {
      docId: doc.docId,
      updates: [{ nodeId: id, patch: { appearance: { fills: [{ color: "#FF0000" }] } } }],
    });
    expect((await full(id)).appearance.strokes).toEqual([
      { color: "#000000", width: 1, cap: "butt", join: "miter", miterLimit: 10, dash: [] },
    ]);
  });

  it("changes nothing on one bad item, and applies the rest with partial", async () => {
    const { doc, make, rect } = await setup();
    const [id] = (await make([rect])).createdIds;
    const updates = [
      { nodeId: id, patch: { name: "ok" } },
      { nodeId: "nope", patch: { name: "x" } },
    ];
    const atomic = await call("zibel_node_update", { docId: doc.docId, updates });
    expect(errorOf(atomic)).toMatchObject({
      code: "NODE_NOT_FOUND",
      hint: expect.any(String),
      path: "updates[1].nodeId",
    });
    const outline = async () =>
      (await call("zibel_doc_outline", { docId: doc.docId })).structuredContent;
    expect(await outline()).toMatchObject({ rev: 2, nodes: [{ children: [{ name: "" }] }] });

    const partial = await call("zibel_node_update", { docId: doc.docId, updates, partial: true });
    expect(partial.structuredContent).toMatchObject({
      rev: 3,
      updatedIds: [id],
      failed: [
        { index: 1, code: "NODE_NOT_FOUND", hint: expect.any(String), path: "updates[1].nodeId" },
      ],
    });
    expect(await outline()).toMatchObject({ rev: 3, nodes: [{ children: [{ name: "ok" }] }] });
  });

  it("deletes a Group with its descendants, gone from doc_outline", async () => {
    const { doc, make } = await setup();
    const { createdIds, keyMap } = await make([
      {
        type: "group",
        parentId: doc.defaultLayerId,
        clientKey: "g",
        children: [
          { type: "rect", x: 0, y: 0, width: 5, height: 5 },
          { type: "group", children: [{ type: "line", x1: 0, y1: 0, x2: 5, y2: 5 }] },
        ],
      },
    ]);
    const deleted = await call("zibel_node_delete", { docId: doc.docId, nodeIds: [keyMap.g] });
    expect([...deleted.structuredContent.deletedIds].sort()).toEqual([...createdIds].sort());
    expect(
      (await call("zibel_doc_outline", { docId: doc.docId, depth: 3 })).structuredContent,
    ).toMatchObject({ nodes: [{ childCount: 0 }] });
    expect(
      errorOf(await call("zibel_node_get", { docId: doc.docId, nodeIds: [createdIds[3]] })),
    ).toMatchObject({ code: "NODE_NOT_FOUND" });
  });

  it("moves a Group by its leaves, so later children still use document coordinates", async () => {
    const { doc, make, full } = await setup();
    const { createdIds } = await make([
      {
        type: "group",
        parentId: doc.defaultLayerId,
        children: [{ type: "rect", x: 0, y: 0, width: 5, height: 5 }],
      },
    ]);
    const [groupId, leafId] = createdIds;
    const moved = await call("zibel_node_transform", {
      docId: doc.docId,
      nodeIds: [groupId],
      translate: { x: 100 },
    });
    expect(moved.structuredContent).toMatchObject({
      updatedIds: [leafId],
      bounds: { x: 100, y: 0, width: 5, height: 5 },
    });
    expect(await full(groupId)).toMatchObject({ transform: [1, 0, 0, 1, 0, 0] });
    const [later] = (
      await make([{ type: "rect", parentId: groupId, x: 10, y: 10, width: 5, height: 5 }])
    ).createdIds;
    expect(await full(later)).toMatchObject({ geometricBounds: { x: 10, y: 10 } });
  });

  it("returns LIMIT_EXCEEDED for 2000 inline children plus their Group, and NODE_NOT_FOUND with hints", async () => {
    const { doc } = await setup();
    const big = await call("zibel_node_create", {
      docId: doc.docId,
      nodes: [
        {
          type: "group",
          parentId: doc.defaultLayerId,
          children: Array(2000).fill({ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }),
        },
      ],
    });
    expect(errorOf(big)).toMatchObject({
      code: "LIMIT_EXCEEDED",
      hint: expect.stringContaining("Split"),
      path: "nodes",
    });
    // The published schema keeps TransformInput's refinements through safeExtend.
    for (const parts of [
      {},
      { matrix: [1, 0, 0, 1, 0, 0], rotate: 1 },
      { matrix: [0, 0, 0, 0, 0, 0] },
    ]) {
      const bad = await call("zibel_node_transform", {
        docId: doc.docId,
        nodeIds: [doc.defaultLayerId],
        ...parts,
      });
      expect(bad.isError).toBe(true);
    }
    for (const [tool, args, path] of [
      ["zibel_node_delete", { nodeIds: ["nope"] }, "nodeIds[0]"],
      ["zibel_node_transform", { nodeIds: ["nope"], rotate: 1 }, "nodeIds[0]"],
    ] as const) {
      expect(errorOf(await call(tool, { docId: doc.docId, ...args }))).toMatchObject({
        code: "NODE_NOT_FOUND",
        hint: expect.any(String),
        path,
      });
    }
  });

  it("stores intent with the Transaction and the Actor who wrote it", async () => {
    const { doc, make, rect } = await setup();
    const [id] = (await make([rect])).createdIds;
    await call("zibel_node_update", {
      docId: doc.docId,
      updates: [{ nodeId: id, patch: { name: "red" } }],
      intent: "make it red",
    });
    const log = await env.DOCUMENT.get(env.DOCUMENT.idFromName(doc.docId)).changes(0);
    expect("changes" in log && log.changes.at(-1)).toMatchObject({
      actor: "agent-a",
      intent: "make it red",
      updatedIds: [id],
    });
  });
});

describe("transactions", () => {
  afterEach(() => vi.useRealTimers());

  /** A Document with one committed rect (rev 2), and helpers bound to it. */
  const setup = async () => {
    const doc = await newDoc();
    const docId = doc.docId as string;
    const rect = {
      type: "rect",
      parentId: doc.defaultLayerId,
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    };
    const tool = async (name: string, args: object = {}, token?: string) =>
      call(`zibel_${name}`, { docId, ...args }, token);
    const ok = async (name: string, args: object = {}, token?: string) => {
      const result = await tool(name, args, token);
      if (result.isError) throw new Error(result.content[0].text);
      return result.structuredContent;
    };
    const err = async (name: string, args: object = {}, token?: string) =>
      errorOf(await tool(name, args, token));
    const [rectId] = (await ok("node_create", { nodes: [rect] })).createdIds;
    const children = async (txId?: string) =>
      (await ok("doc_outline", { txId })).nodes[0].children?.map((c: { id: string }) => c.id) ?? [];
    return { docId, rect, rectId, tool, ok, err, children };
  };

  it("shows uncommitted edits only to reads carrying the txId, then commits them in one rev", async () => {
    const { rect, rectId, ok, err, children } = await setup();
    const { txId, rev } = await ok("tx_begin", { label: "Add a box" });
    expect(rev).toBe(2);
    const made = await ok("node_create", { nodes: [rect], txId });
    expect(made).toMatchObject({ txId, rev: 2 });
    const [id] = made.createdIds;
    await ok("node_update", { updates: [{ nodeId: id, patch: { name: "box" } }], txId });
    await ok("node_transform", { nodeIds: [id], translate: { x: 5 }, txId });

    expect((await ok("node_get", { nodeIds: [id], txId })).nodes).toMatchObject([
      { name: "box", geometricBounds: { x: 15 } },
    ]);
    expect(await err("node_get", { nodeIds: [id] })).toMatchObject({ code: "NODE_NOT_FOUND" });
    expect(await children(txId)).toEqual([rectId, id]);
    expect(await children()).toEqual([rectId]);
    const png = await ok("render", { txId });
    expect(png.viewport.docRect).toBeDefined();
    expect((await ok("doc_outline")).rev).toBe(2);

    expect(await ok("tx_commit", { txId })).toMatchObject({
      txId,
      rev: 3,
      createdIds: [id],
      updatedIds: [],
      deletedIds: [],
    });
    expect(await children()).toEqual([rectId, id]);
    expect((await ok("node_get", { nodeIds: [id] })).nodes).toMatchObject([{ name: "box" }]);
    expect(await ok("doc_changes", { sinceRev: 2 })).toMatchObject({
      rev: 3,
      changes: [{ rev: 3, txId, summary: "Add a box", createdIds: [id] }],
    });
  });

  it("rolls back to the Document exactly as it was before tx_begin", async () => {
    const { rect, rectId, ok, err } = await setup();
    const before = await ok("doc_outline", { depth: 5 });
    const changes = await ok("doc_changes", { sinceRev: 0 });
    const { txId } = await ok("tx_begin");
    await ok("node_create", { nodes: [rect], txId });
    await ok("node_update", { updates: [{ nodeId: rectId, patch: { name: "x" } }], txId });
    await ok("node_delete", { nodeIds: [rectId], txId });
    expect(await ok("tx_rollback", { txId })).toEqual({ txId, rev: 2 });
    expect(await ok("doc_outline", { depth: 5 })).toEqual(before);
    expect((await ok("node_get", { nodeIds: [rectId], detail: "full" })).nodes).toMatchObject([
      { name: "" },
    ]);
    expect(await ok("doc_changes", { sinceRev: 0 })).toEqual(changes);
    expect(await err("node_get", { nodeIds: [rectId], txId })).toMatchObject({
      code: "TX_EXPIRED",
      hint: expect.stringContaining("rolled back"),
    });
  });

  it("expires an idle Transaction through the alarm; the next call gets TX_EXPIRED", async () => {
    const { docId, rect, ok, err, children, rectId } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { txId } = await ok("tx_begin");
    await ok("node_create", { nodes: [rect], txId });
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
    expect(await runDurableObjectAlarm(env.DOCUMENT.get(env.DOCUMENT.idFromName(docId)))).toBe(
      true,
    );
    expect(await err("node_create", { nodes: [rect], txId })).toMatchObject({
      code: "TX_EXPIRED",
      hint: expect.stringContaining("idle"),
      path: "txId",
    });
    expect(await children()).toEqual([rectId]);
  });

  it("rejects a write with a stale ifRev with REV_CONFLICT and changes nothing", async () => {
    const { rectId, ok, err } = await setup();
    const update = (ifRev: number, name: string) => ({
      updates: [{ nodeId: rectId, patch: { name } }],
      ifRev,
    });
    expect(await err("node_update", update(1, "x"))).toMatchObject({
      code: "REV_CONFLICT",
      rev: 2,
      nodeIds: [rectId],
      hint: expect.stringContaining("zibel_doc_changes"),
      path: "ifRev",
    });
    expect(await err("node_delete", { nodeIds: [rectId], ifRev: 1 })).toMatchObject({
      code: "REV_CONFLICT",
    });
    expect(await ok("doc_outline")).toMatchObject({ rev: 2, nodes: [{ childCount: 1 }] });
    expect((await ok("node_get", { nodeIds: [rectId], detail: "full" })).nodes).toMatchObject([
      { name: "" },
    ]);
    expect(await ok("node_update", update(2, "y"))).toMatchObject({ rev: 3 });

    const { txId } = await ok("tx_begin");
    await ok("node_update", { ...update(3, "z"), txId });
    expect(await err("tx_commit", { txId, ifRev: 2 })).toMatchObject({ code: "REV_CONFLICT" });
    expect(await ok("tx_commit", { txId, ifRev: 3 })).toMatchObject({ rev: 4 });
  });

  it("fails the commit with NODE_GONE when a Node it edited was deleted outside", async () => {
    const { rectId, ok, err } = await setup();
    const { txId } = await ok("tx_begin");
    await ok("node_update", { updates: [{ nodeId: rectId, patch: { opacity: 0.5 } }], txId });
    await ok("node_delete", { nodeIds: [rectId] }, "dev-token-a");
    expect(await err("tx_commit", { txId })).toMatchObject({
      code: "NODE_GONE",
      nodeIds: [rectId],
      hint: expect.stringContaining("zibel_tx_rollback"),
    });
    expect((await ok("doc_outline")).rev).toBe(3);
    expect(await ok("tx_rollback", { txId })).toEqual({ txId, rev: 3 });
  });

  it("lists Transactions from two Actors in doc_changes with their attribution", async () => {
    const { rect, rectId, ok, err } = await setup();
    await ok(
      "node_update",
      { updates: [{ nodeId: rectId, patch: { name: "b" } }], intent: "rename" },
      "dev-token-b",
    );
    const { txId } = await ok("tx_begin", { label: "Two boxes" });
    const { createdIds } = await ok("node_create", { nodes: [rect, rect], txId });
    await ok("tx_commit", { txId, intent: "more boxes" });
    expect(await ok("doc_changes", { sinceRev: 1 })).toEqual({
      rev: 4,
      changes: [
        expect.objectContaining({ rev: 2, actor: "agent-a", createdIds: [rectId] }),
        expect.objectContaining({
          rev: 3,
          actor: "agent-b",
          updatedIds: [rectId],
          intent: "rename",
        }),
        {
          rev: 4,
          txId,
          actor: "agent-a",
          summary: "Two boxes",
          createdIds,
          updatedIds: [],
          deletedIds: [],
          intent: "more boxes",
        },
      ],
    });
    expect(await ok("doc_changes", { sinceRev: 1, limit: 1 })).toMatchObject({
      rev: 4,
      changes: [{ rev: 2 }],
    });
    expect(await err("node_create", { nodes: [rect], txId: "01NOPE" })).toMatchObject({
      code: "TX_NOT_FOUND",
    });
  });

  it("keeps a Transaction to the Actor that began it", async () => {
    const { rect, ok, err } = await setup();
    const { txId } = await ok("tx_begin");
    expect(await err("node_create", { nodes: [rect], txId }, "dev-token-b")).toMatchObject({
      code: "TX_NOT_FOUND",
    });
    expect(await err("tx_commit", { txId }, "dev-token-b")).toMatchObject({
      code: "TX_NOT_FOUND",
    });
    expect(await ok("node_create", { nodes: [rect], txId })).toMatchObject({ txId });
  });
});

describe("node_query", () => {
  /** Layer 1: "Sun" rect (sky, warm) at 0,0 and Group "G" holding "Moon" rect (sky) at 100,50 and a text. */
  const scene = async () => {
    const { docId, defaultLayerId } = await newDoc();
    const r = (name: string, x: number, y: number, tags: string[]) => ({
      type: "rect",
      name,
      x,
      y,
      width: 10,
      height: 10,
      tags,
      clientKey: name,
    });
    const { keyMap } = (
      await call("zibel_node_create", {
        docId,
        nodes: [
          { ...r("Sun", 0, 0, ["sky", "warm"]), parentId: defaultLayerId },
          {
            type: "group",
            name: "G",
            clientKey: "G",
            parentId: defaultLayerId,
            children: [
              r("Moon", 100, 50, ["sky"]),
              { type: "text", x: 100, y: 90, content: "Hi", clientKey: "T" },
            ],
          },
        ],
      })
    ).structuredContent;
    const query = async (filter: object) => {
      const result = await call("zibel_node_query", { docId, ...filter });
      expect(result.isError).toBeFalsy();
      return result.structuredContent;
    };
    const names = async (filter: object) =>
      ((await query(filter)).nodes as { name: string; type: string }[])
        .map((n) => n.name || n.type)
        .sort();
    return { docId, defaultLayerId, keyMap, query, names };
  };

  it("filters by each of types, nameRegex, tags, parentId, withinRect and intersectsRect", async () => {
    const { defaultLayerId, keyMap, names, query } = await scene();
    expect(await names({})).toEqual(["G", "Layer 1", "Moon", "Sun", "text"]);
    expect(await names({ types: ["rect"] })).toEqual(["Moon", "Sun"]);
    expect(await names({ nameRegex: "^[SM]" })).toEqual(["Moon", "Sun"]);
    expect(await names({ tags: ["sky", "warm"] })).toEqual(["Sun"]);
    expect(await names({ parentId: defaultLayerId })).toEqual(["G", "Sun"]);
    expect(await names({ parentId: keyMap.G })).toEqual(["Moon", "text"]);
    expect(await names({ withinRect: { x: 90, y: 40, width: 50, height: 60 } })).toEqual([
      "G",
      "Moon",
      "text",
    ]);
    expect(await names({ intersectsRect: { x: 10, y: 10, width: 1, height: 1 } })).toEqual([
      "Layer 1",
      "Sun",
    ]);
    const { nodes, rev, nextCursor } = await query({ nameRegex: "^Sun$" });
    expect({ rev, nextCursor }).toEqual({ rev: 2, nextCursor: null });
    expect(nodes).toEqual([
      {
        id: keyMap.Sun,
        type: "rect",
        name: "Sun",
        parentId: defaultLayerId,
        visible: true,
        locked: false,
        childCount: 0,
        geometricBounds: { x: 0, y: 0, width: 10, height: 10 },
      },
    ]);
  });

  it("ANDs filters together", async () => {
    const { keyMap, names } = await scene();
    expect(await names({ tags: ["sky"], parentId: keyMap.G })).toEqual(["Moon"]);
    expect(
      await names({
        types: ["rect", "text"],
        intersectsRect: { x: 0, y: 0, width: 200, height: 60 },
      }),
    ).toEqual(["Moon", "Sun"]);
  });

  it("pages through more than one page with cursor, in id order", async () => {
    const { docId, defaultLayerId } = await newDoc();
    const rect = { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 1, height: 1 };
    const created = (
      await call("zibel_node_create", { docId, nodes: Array.from({ length: 5 }, () => rect) })
    ).structuredContent.createdIds as string[];
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = (await call("zibel_node_query", { docId, types: ["rect"], limit: 2, cursor }))
        .structuredContent;
      pages.push(page.nodes.map((n: { id: string }) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(pages.flat()).toEqual([...created].sort());
  });

  it("rejects a nameRegex that does not compile, naming the field", async () => {
    const { docId } = await newDoc();
    const result = await call("zibel_node_query", { docId, nameRegex: "(" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/regular expression.*nameRegex/);
  });
});

describe("doc_outline options", () => {
  const scene = async () => {
    const { docId, defaultLayerId } = await newDoc();
    const { keyMap } = (
      await call("zibel_node_create", {
        docId,
        nodes: [
          { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 5, height: 5 },
          {
            type: "group",
            parentId: defaultLayerId,
            clientKey: "G",
            children: [
              { type: "rect", x: 0, y: 0, width: 5, height: 5 },
              { type: "text", x: 0, y: 20, content: "Hi" },
            ],
          },
          { type: "layer", name: "Layer 2" },
        ],
      })
    ).structuredContent;
    const outline = async (opts: object) =>
      (await call("zibel_doc_outline", { docId, ...opts })).structuredContent;
    return { keyMap, outline };
  };

  it("returns only the Layers at depth 1, with their childCount", async () => {
    const { outline } = await scene();
    const { nodes } = await outline({ depth: 1 });
    expect(nodes).toEqual([
      expect.objectContaining({ type: "layer", name: "Layer 1", childCount: 2 }),
      expect.objectContaining({ type: "layer", name: "Layer 2", childCount: 0 }),
    ]);
    expect(nodes.some((n: object) => "children" in n)).toBe(false);
  });

  it("starts at rootId's children; an unknown rootId is NODE_NOT_FOUND", async () => {
    const { keyMap, outline } = await scene();
    const { nodes } = await outline({ rootId: keyMap.G });
    expect(nodes.map((n: { type: string }) => n.type)).toEqual(["rect", "text"]);
    const docId = (await newDoc()).docId;
    const result = await call("zibel_doc_outline", { docId, rootId: "01NOPE" });
    expect(errorOf(result)).toMatchObject({ code: "NODE_NOT_FOUND", path: "rootId" });
  });

  it("keeps the listed types with their ancestors, and drops bounds on request", async () => {
    const { outline } = await scene();
    const { nodes } = await outline({ depth: 3, types: ["text"], includeBounds: false });
    expect(nodes).toEqual([
      expect.objectContaining({
        name: "Layer 1",
        childCount: 2,
        children: [
          expect.objectContaining({
            type: "group",
            childCount: 2,
            children: [expect.objectContaining({ type: "text" })],
          }),
        ],
      }),
      expect.objectContaining({ name: "Layer 2" }),
    ]);
    expect(JSON.stringify(nodes)).not.toContain("bounds");
  });
});

it("returns a non-empty hint with every error code a tool can return", async () => {
  const doc = await newDoc();
  const { docId, defaultLayerId } = doc;
  const tool = async (name: string, args: object) => errorOf(await call(name, { docId, ...args }));
  const rect = { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 1, height: 1 };
  const create = async (node: object) =>
    (await call("zibel_node_create", { docId, nodes: [node] })).structuredContent.createdIds[0];
  // A new ErrorCode fails tsc here until it gets a trigger.
  const triggers: Record<ErrorCode, (() => Promise<{ code: string; hint: string }>) | null> = {
    DOC_NOT_FOUND: () => call("zibel_doc_get_info", { docId: "nope" }).then(errorOf),
    NODE_NOT_FOUND: () => tool("zibel_node_get", { nodeIds: ["nope"] }),
    ARTBOARD_NOT_FOUND: () => tool("zibel_render", { scope: { artboardId: "nope" } }),
    NOTHING_TO_RENDER: async () =>
      tool("zibel_render", {
        scope: { nodeIds: [await create({ type: "group", parentId: defaultLayerId })] },
      }),
    INVALID_PARENT: () =>
      tool("zibel_node_create", { nodes: [{ ...rect, parentId: doc.artboards[0].id }] }),
    INVALID_COLOR: () => tool("zibel_render", { background: "red" }),
    INVALID_PATH: () =>
      tool("zibel_node_create", { nodes: [{ type: "path", parentId: defaultLayerId, d: "h 1" }] }),
    INVALID_PATCH: () =>
      tool("zibel_node_update", { updates: [{ nodeId: defaultLayerId, patch: { type: "rect" } }] }),
    LIMIT_EXCEEDED: () => tool("zibel_node_create", { nodes: Array(2001).fill(rect) }),
    PERMISSION_DENIED: async () => (await rpc("tools/list", {}, "nope")).body.error.data,
    REV_CONFLICT: () => tool("zibel_node_create", { nodes: [rect], ifRev: 99 }),
    NODE_GONE: async () => {
      const id = await create(rect);
      const { txId } = (await call("zibel_tx_begin", { docId })).structuredContent;
      await call("zibel_node_update", { docId, txId, updates: [{ nodeId: id, patch: { x: 1 } }] });
      await call("zibel_node_delete", { docId, nodeIds: [id] });
      return tool("zibel_tx_commit", { txId });
    },
    TX_NOT_FOUND: () => tool("zibel_tx_commit", { txId: "nope" }),
    TX_EXPIRED: async () => {
      const { txId } = (await call("zibel_tx_begin", { docId })).structuredContent;
      await call("zibel_tx_rollback", { docId, txId });
      return tool("zibel_tx_commit", { txId });
    },
    INVALID_DOCUMENT: () => call("zibel_doc_open", { content: "{" }).then(errorOf),
    // Undo and redo are browser commands over the WebSocket, not tools (ADR-0011).
    NOTHING_TO_UNDO: null,
    NOTHING_TO_REDO: null,
  };
  for (const [code, trigger] of Object.entries(triggers)) {
    if (!trigger) continue;
    expect(await trigger(), code).toMatchObject({ code, hint: expect.stringMatching(/\S/) });
  }
});

it("serves skill://zibel/drawing-conventions as a resource and points at it on initialize", async () => {
  const uri = "skill://zibel/drawing-conventions";
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  expect(init.body.result.instructions).toContain(uri);
  const listed = (await rpc("resources/list")).body.result.resources;
  expect(listed).toContainEqual(expect.objectContaining({ uri, mimeType: "text/markdown" }));
  const [doc] = (await rpc("resources/read", { uri })).body.result.contents;
  expect(doc).toMatchObject({ uri, mimeType: "text/markdown" });
  for (const fact of [
    "#RRGGBB",
    "y down",
    "parentId",
    "ifRev",
    "zibel_doc_changes",
    "zibel_json",
    "zibel_doc_open",
    "INVALID_DOCUMENT",
  ]) {
    expect(doc.text).toContain(fact);
  }
  // Drift guard: the document names only tools that exist; zibel_json is an export format.
  const tools = new Set(
    (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name),
  );
  for (const [name] of doc.text.matchAll(/zibel_(?!json\b)[a-z_]+/g)) expect(tools).toContain(name);
  expect((await rpc("resources/read", { uri: "skill://zibel/nope" })).body.error).toBeDefined();
});

describe("zibel_json", () => {
  it("exports the whole Document as .zibel.json text, with a Transaction's edits under its txId", async () => {
    const doc = await newDoc();
    const { docId, defaultLayerId } = doc;
    const rect = { type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 10, height: 10 };
    const [rectId] = (await call("zibel_node_create", { docId, nodes: [rect] })).structuredContent
      .createdIds;
    const result = await call("zibel_export", { docId, format: "zibel_json" });
    expect(result.structuredContent).toEqual({});
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    const file = JSON.parse(text);
    expect(file).toMatchObject({ version: 1, name: "Doc", artboards: doc.artboards });
    expect(file.nodes).toHaveLength(2);
    const scoped = await call("zibel_export", {
      docId,
      format: "zibel_json",
      scope: { nodeIds: [rectId] },
    });
    expect(scoped.content[0].text).toBe(text);
    const { txId } = (await call("zibel_tx_begin", { docId })).structuredContent;
    await call("zibel_node_create", { docId, txId, nodes: [rect] });
    const nodesOf = async (args: object) =>
      JSON.parse(
        (await call("zibel_export", { docId, format: "zibel_json", ...args })).content[0].text,
      ).nodes;
    expect(await nodesOf({ txId })).toHaveLength(3);
    expect(await nodesOf({})).toHaveLength(2);
  });

  it("opens an exported file as a new Document that keeps its ids and exports the same text", async () => {
    const doc = await newDoc();
    const { docId, defaultLayerId: parentId } = doc;
    const { keyMap } = (
      await call("zibel_node_create", {
        docId,
        nodes: [
          { type: "layer", name: "Top" },
          {
            type: "group",
            parentId,
            children: [{ type: "rect", clientKey: "rect", x: 1, y: 2, width: 3, height: 4 }],
          },
          { type: "ellipse", parentId, x: 0, y: 0, width: 5, height: 5 },
          { type: "line", parentId, x1: 0, y1: 0, x2: 5, y2: 5 },
          { type: "polygon", parentId, cx: 9, cy: 9, radius: 4, sides: 5 },
          { type: "star", parentId, cx: 9, cy: 9, outerRadius: 4, innerRadius: 2, points: 5 },
          { type: "path", parentId, d: "M 0 0 C 1 1 2 2 3 0 Q 4 4 0 0 Z" },
          {
            type: "text",
            parentId,
            clientKey: "text",
            x: 0,
            y: 20,
            content: "Hi",
            meta: { b: 1, a: [2] },
          },
        ],
      })
    ).structuredContent;
    await call("zibel_node_transform", { docId, nodeIds: [keyMap.rect], rotate: 30 });
    await call("zibel_node_update", {
      docId,
      updates: [{ nodeId: keyMap.text, patch: { name: "Title", tags: ["t"] } }],
    });
    const exportOf = async (id: string) =>
      (await call("zibel_export", { docId: id, format: "zibel_json" })).content[0].text as string;
    const text = await exportOf(docId);

    const opened = await call("zibel_doc_open", { content: text, intent: "reopen" });
    const { docId: newId, ...rest } = opened.structuredContent;
    expect(newId).not.toBe(docId);
    expect(rest).toEqual({
      name: "Doc",
      artboards: doc.artboards,
      rev: 1,
      warnings: [],
      nodes: [
        expect.objectContaining({
          id: parentId,
          type: "layer",
          childCount: 7,
          bounds: expect.any(Object),
        }),
        expect.objectContaining({ type: "layer", name: "Top", childCount: 0, bounds: null }),
      ],
    });
    expect(rest.nodes[0]).not.toHaveProperty("children");
    expect(await exportOf(newId)).toBe(text);
    const [rect] = (
      await call("zibel_node_get", { docId: newId, nodeIds: [keyMap.rect], detail: "full" })
    ).structuredContent.nodes;
    expect(rect).toMatchObject({ id: keyMap.rect, type: "rect", width: 3 });
    const { changes } = (await call("zibel_doc_changes", { docId: newId, sinceRev: 0 }))
      .structuredContent;
    expect(changes).toEqual([
      expect.objectContaining({
        rev: 1,
        actor: "agent-a",
        summary: 'Open Document "Doc"',
        intent: "reopen",
        createdIds: expect.arrayContaining([keyMap.rect, keyMap.text]),
      }),
    ]);
    const { documents } = (await call("zibel_doc_list", {})).structuredContent;
    expect(documents[0]).toEqual({ docId: newId, name: "Doc", createdAt: expect.any(String) });
  });

  it("opens Zibel's own SVG export as the Document it came from, byte for byte", async () => {
    // The #25 export of the fixture Document, every mapping ADR-0017 lists.
    const opened = await call("zibel_doc_open", { content: exported });
    const { docId, ...rest } = opened.structuredContent;
    const file = JSON.parse(fixture);
    expect(rest).toMatchObject({ name: file.name, artboards: file.artboards, warnings: [] });
    expect(rest.nodes.map((n: { id: string }) => n.id)).toEqual(
      file.nodes
        .filter((n: { type: string; parentId: string | null }) => n.type === "layer" && !n.parentId)
        .map((n: { id: string }) => n.id),
    );
    // The same Document opened from its .zibel.json exports the same text.
    const exportOf = async (id: string) =>
      (await call("zibel_export", { docId: id, format: "zibel_json" })).content[0].text as string;
    const fromJson = (await call("zibel_doc_open", { content: fixture })).structuredContent.docId;
    expect(await exportOf(docId)).toBe(await exportOf(fromJson));
  });

  it("opens an Inkscape file in mm with a moved layer, class styles and a turned star", async () => {
    const svg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg width="100mm" height="50mm" viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"',
      ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
      ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docname="drawing.svg">',
      "<defs><style>.a{fill:rgb(0,128,255)}</style></defs>",
      '<g inkscape:groupmode="layer" id="layer1" inkscape:label="Layer 1" transform="translate(10,5)">',
      '<rect id="rect123" class="a" x="0" y="0" width="20" height="10"/>',
      '<path sodipodi:type="star" id="path456" sodipodi:sides="5" sodipodi:cx="50" sodipodi:cy="20"',
      ' sodipodi:r1="10" sodipodi:r2="4" sodipodi:arg1="0" sodipodi:arg2="0.62831853"',
      ' inkscape:flatsided="false" inkscape:rounded="0" inkscape:randomized="0" d="M 60 20 L 50 30 Z"',
      ' style="fill:#ff0000;stroke:#000000;stroke-width:0.5"/>',
      "</g></svg>",
    ].join("\n");
    const opened = (await call("zibel_doc_open", { content: svg })).structuredContent;
    expect(opened).toMatchObject({
      name: "drawing",
      artboards: [{ frame: { x: 0, y: 0, width: 283.465, height: 141.732 } }],
      warnings: [],
    });
    const layer = opened.nodes[0];
    expect(layer).toMatchObject({ name: "Layer 1", type: "layer", childCount: 2 });
    const outline = (await call("zibel_doc_outline", { docId: opened.docId })).structuredContent;
    const ids = outline.nodes[0].children.map((c: { id: string }) => c.id);
    const [rect, star] = (
      await call("zibel_node_get", { docId: opened.docId, nodeIds: ids, detail: "full" })
    ).structuredContent.nodes;
    expect(rect.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(rect).toMatchObject({
      type: "rect",
      x: 28.346,
      y: 14.173,
      width: 56.693,
      height: 28.346,
      appearance: { fills: [{ color: "#0080FF" }], strokes: [] },
    });
    // The turn stays a matrix, in user units, the layer's move and the mm scale included.
    expect(star).toMatchObject({ type: "star", cx: 50, cy: 20, outerRadius: 10, points: 5 });
    expect(star.transform).toEqual([0, 2.834646, -2.834646, 0, 226.771654, -70.866142]);
    expect(star.appearance.strokes[0]).toMatchObject({ color: "#000000", width: 0.5 });
  });

  it("refuses an SVG over 5 MB, or one that is not well-formed, and creates nothing", async () => {
    const count = async () => (await call("zibel_doc_list", {})).structuredContent.documents.length;
    const before = await count();
    const big = `<svg xmlns="http://www.w3.org/2000/svg"><desc>${"x".repeat(5 * 1024 * 1024)}</desc></svg>`;
    expect(errorOf(await call("zibel_doc_open", { content: big }))).toMatchObject({
      code: "LIMIT_EXCEEDED",
      hint: expect.stringMatching(/\S/),
    });
    expect(errorOf(await call("zibel_doc_open", { content: "<svg><g></svg>" }))).toMatchObject({
      code: "INVALID_DOCUMENT",
      path: "content",
    });
    expect(await count()).toBe(before);
  });

  it("returns a validation error with a path and creates nothing for a malformed file", async () => {
    const count = async () => (await call("zibel_doc_list", {})).structuredContent.documents.length;
    const before = await count();
    const notJson = errorOf(await call("zibel_doc_open", { content: "{" }));
    expect(notJson).toMatchObject({
      code: "INVALID_DOCUMENT",
      path: "content",
      hint: expect.stringMatching(/\S/),
    });
    const { docId, defaultLayerId } = await newDoc();
    await call("zibel_node_create", {
      docId,
      nodes: [{ type: "rect", parentId: defaultLayerId, x: 0, y: 0, width: 1, height: 1 }],
    });
    const file = JSON.parse(
      (await call("zibel_export", { docId, format: "zibel_json" })).content[0].text,
    );
    const i = file.nodes.findIndex((n: { type: string }) => n.type === "rect");
    file.nodes[i].appearance.fills[0].color = "red";
    const badColor = errorOf(await call("zibel_doc_open", { content: JSON.stringify(file) }));
    expect(badColor).toMatchObject({
      code: "INVALID_COLOR",
      path: `nodes[${i}].appearance.fills[0].color`,
    });
    expect(await count()).toBe(before + 1);
  });
});
