import { evictAllDurableObjects } from "cloudflare:test";
import { exports } from "cloudflare:workers";
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
  const tools = body.result.tools as { name: string; annotations: object; outputSchema: object }[];
  expect(tools.map((t) => t.name).sort()).toEqual([
    "zibel_doc_create",
    "zibel_doc_outline",
    "zibel_node_create",
    "zibel_render",
  ]);
  for (const t of tools) {
    expect(t.annotations).toHaveProperty("readOnlyHint");
    expect(t.annotations).toHaveProperty("openWorldHint", false);
    expect(t.outputSchema).toMatchObject({ type: "object" });
  }
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
