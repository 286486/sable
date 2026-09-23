import { evictAllDurableObjects } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { COLOR_PATTERN } from "@zibel/core";
import { expect, it } from "vitest";
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
    "zibel_doc_create",
    "zibel_doc_outline",
    "zibel_node_create",
    "zibel_node_get",
    "zibel_render",
  ]);
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
  const result = await call("zibel_doc_outline", { docId: "01NOPE" });
  expect(errorOf(result)).toMatchObject({ code: "DOC_NOT_FOUND", hint: expect.any(String) });
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
  expect(tooManyNodes.isError).toBe(true);
  expect(tooManyNodes.content[0].text).toMatch(/nodes/);
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
