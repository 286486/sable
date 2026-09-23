import { exports } from "cloudflare:workers";
import type { ServerMessage } from "@zibel/sync";
import { afterEach, expect, it } from "vitest";
import { call } from "./rpc.ts";

const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});

const upgrade = (docId: string) =>
  exports.default.fetch(`http://zibel/api/docs/${docId}/ws`, {
    headers: { upgrade: "websocket" },
  });

/** Opens a browser socket and collects every message it receives. */
async function subscribe(docId: string) {
  const res = await upgrade(docId);
  const ws = res.webSocket;
  if (!ws) throw new Error(`no WebSocket: ${res.status}`);
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
    for (const w of waiters.splice(0)) w();
  });
  ws.accept();
  open.push(ws);
  /** Resolves once `n` messages have arrived. */
  const received = async (n: number) => {
    while (messages.length < n) await new Promise<void>((r) => waiters.push(r));
    return messages;
  };
  return { ws, messages, received };
}

const newDoc = async () =>
  (await call("zibel_doc_create", { name: "Doc", artboards: [{ width: 200, height: 100 }] }))
    .structuredContent;

const rect = (parentId: string) => ({
  type: "rect",
  parentId,
  x: 10,
  y: 10,
  width: 50,
  height: 30,
});

it("answers 404 before the upgrade for an unknown docId", async () => {
  const res = await upgrade("01NOPE");
  expect(res.status).toBe(404);
  expect(res.webSocket).toBeNull();
});

it("sends the Document on connect, then a tx after node_create commits", async () => {
  const { docId, defaultLayerId, artboards } = await newDoc();
  const { received } = await subscribe(docId);

  const [first] = await received(1);
  expect(first).toMatchObject({ type: "document", rev: 1, name: "Doc", artboards });
  expect(first?.type === "document" && first.nodes.map((n) => n.id)).toEqual([defaultLayerId]);

  const receipt = (await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] }))
    .structuredContent;
  const [, tx] = await received(2);
  expect(tx).toMatchObject({
    type: "tx",
    rev: 2,
    txId: receipt.txId,
    actor: "agent-a",
    updated: [],
    deletedIds: [],
  });
  expect(tx?.type === "tx" && tx.created).toMatchObject([
    { id: receipt.createdIds[0], type: "rect", width: 50 },
  ]);
});

it("counts open sockets in doc_get_info", async () => {
  const { docId } = await newDoc();
  const { received } = await subscribe(docId);
  await received(1);
  expect((await call("zibel_doc_get_info", { docId })).structuredContent.browsers).toBe(1);
});

it("broadcasts a Transaction once, at tx_commit, not its staged writes", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const { messages, received } = await subscribe(docId);
  await received(1);
  const { txId } = (await call("zibel_tx_begin", { docId })).structuredContent;
  const staged = (await call("zibel_node_create", { docId, txId, nodes: [rect(defaultLayerId)] }))
    .structuredContent;
  expect(messages).toHaveLength(1);

  await call("zibel_tx_commit", { docId, txId });
  const [, tx] = await received(2);
  expect(tx).toMatchObject({ type: "tx", rev: 2, txId, updated: [], deletedIds: [] });
  expect(tx?.type === "tx" && tx.created.map((n) => n.id)).toEqual(staged.createdIds);
});

it("lists Documents newest first at GET /api/docs", async () => {
  const a = await call("zibel_doc_create", {
    name: "First",
    artboards: [{ width: 10, height: 10 }],
  });
  const b = await call("zibel_doc_create", {
    name: "Second",
    artboards: [{ width: 10, height: 10 }],
  });
  const res = await exports.default.fetch("http://zibel/api/docs");
  expect(res.status).toBe(200);
  const { documents } = (await res.json()) as { documents: { docId: string; name: string }[] };
  expect(documents.slice(0, 2)).toMatchObject([
    { docId: b.structuredContent.docId, name: "Second", createdAt: expect.any(String) },
    { docId: a.structuredContent.docId, name: "First", createdAt: expect.any(String) },
  ]);
});
