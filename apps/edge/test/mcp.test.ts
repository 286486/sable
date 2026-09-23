import { evictAllDurableObjects } from "cloudflare:test";
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
