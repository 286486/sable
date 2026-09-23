import { evictAllDurableObjects, runDurableObjectAlarm } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { COLOR_PATTERN } from "@zibel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    "zibel_doc_outline",
    "zibel_node_create",
    "zibel_node_delete",
    "zibel_node_get",
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
  for (const name of ["zibel_node_get", "zibel_doc_outline", "zibel_render"]) {
    expect(inputKeys(name)).toContain("txId");
  }
  expect(inputKeys("zibel_tx_commit")).toEqual(
    expect.arrayContaining(["docId", "txId", "ifRev", "intent"]),
  );
  expect(byName.zibel_doc_changes?.annotations).toMatchObject({ readOnlyHint: true });
  expect(byName.zibel_doc_get_info?.annotations).toMatchObject({ readOnlyHint: true });
  expect(byName.zibel_tx_rollback?.annotations).toMatchObject({ destructiveHint: true });
  expect(byName.zibel_tx_commit?.annotations).toMatchObject({ destructiveHint: false });
  expect(JSON.stringify(tools)).not.toContain("no effect yet");
  for (const t of tools) {
    expect(t.annotations).toHaveProperty("readOnlyHint");
    expect(t.annotations).toHaveProperty("openWorldHint", false);
    expect(t.outputSchema).toMatchObject({ type: "object" });
  }
  // Core validates colours, but Agents still read the pattern from the published schema (§6.5).
  const nodeCreate = tools.find((t) => t.name === "zibel_node_create");
  expect(JSON.stringify(nodeCreate?.inputSchema)).toContain(
    JSON.stringify({ type: "string", pattern: COLOR_PATTERN }).slice(1, -1),
  );
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
    layers: [
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
  for (const tool of ["zibel_doc_outline", "zibel_doc_get_info"]) {
    const result = await call(tool, { docId: "01NOPE" });
    expect(errorOf(result)).toMatchObject({ code: "DOC_NOT_FOUND", hint: expect.any(String) });
  }
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

it("renders the Document to a PNG with viewport metadata", async () => {
  const doc = await newDoc();
  await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [
      {
        type: "rect",
        parentId: doc.defaultLayerId,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        appearance: { fills: [{ color: "#FF0000" }] },
      },
    ],
  });
  const result = await call("zibel_render", { docId: doc.docId, scale: 2 });
  const image = result.content.find((c: { type: string }) => c.type === "image");
  expect(image.mimeType).toBe("image/png");
  const png = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
  const ihdr = new DataView(png.buffer, 16, 8);
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([400, 200]);
  expect(result.structuredContent).toEqual({
    viewport: {
      docRect: { x: 0, y: 0, width: 200, height: 100 },
      pixelSize: { width: 400, height: 200 },
      scale: 2,
    },
  });
});

it("refuses a render larger than 4096 px per side with LIMIT_EXCEEDED", async () => {
  const big = (
    await call("zibel_doc_create", { name: "Big", artboards: [{ width: 2000, height: 100 }] })
  ).structuredContent;
  expect(errorOf(await call("zibel_render", { docId: big.docId, scale: 4 }))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    hint: expect.any(String),
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
  expect(outline).toMatchObject({ rev: 1, layers: [{ childCount: 0 }] });
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
    expect(await outline()).toMatchObject({ rev: 2, layers: [{ children: [{ name: "" }] }] });

    const partial = await call("zibel_node_update", { docId: doc.docId, updates, partial: true });
    expect(partial.structuredContent).toMatchObject({
      rev: 3,
      updatedIds: [id],
      failed: [
        { index: 1, code: "NODE_NOT_FOUND", hint: expect.any(String), path: "updates[1].nodeId" },
      ],
    });
    expect(await outline()).toMatchObject({ rev: 3, layers: [{ children: [{ name: "ok" }] }] });
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
    ).toMatchObject({ layers: [{ childCount: 0 }] });
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
      (await ok("doc_outline", { txId })).layers[0].children?.map((c: { id: string }) => c.id) ??
      [];
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
    expect(await ok("doc_outline")).toMatchObject({ rev: 2, layers: [{ childCount: 1 }] });
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
