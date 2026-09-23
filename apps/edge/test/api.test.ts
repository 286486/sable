import { exports } from "cloudflare:workers";
import type { ServerMessage } from "@zibel/sync";
import { afterEach, expect, it, vi } from "vitest";
import { call, errorOf } from "./rpc.ts";

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

  const receipt = (
    await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)], intent: "A box" })
  ).structuredContent;
  const [, tx] = await received(2);
  expect(tx).toMatchObject({
    type: "tx",
    rev: 2,
    txId: receipt.txId,
    actor: "agent-a",
    intent: "A box",
    updated: [],
    deletedIds: [],
  });
  expect(tx?.type === "tx" && tx.created).toMatchObject([
    { id: receipt.createdIds[0], type: "rect", width: 50 },
  ]);
});

it("counts open sockets in doc_get_info, and drops one the browser closes", async () => {
  const { docId } = await newDoc();
  const { ws, received } = await subscribe(docId);
  await received(1);
  const browsers = async () =>
    (await call("zibel_doc_get_info", { docId })).structuredContent.browsers;
  expect(await browsers()).toBe(1);

  const closed = new Promise((r) => ws.addEventListener("close", r));
  ws.close();
  await closed;
  await vi.waitFor(async () => expect(await browsers()).toBe(0), { timeout: 1000 });
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

/** A browser gesture as ADR-0010 sends it. */
const command = (id: string, command: unknown) => JSON.stringify({ type: "command", id, command });

it("commits a transform command as one Transaction of the User Actor, seen by doc_changes", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const { createdIds, rev } = (
    await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] })
  ).structuredContent;
  const [id] = createdIds;
  const { ws, received } = await subscribe(docId);
  await received(1);

  ws.send(
    command("c1", { type: "transform", input: { nodeIds: [id], translate: { x: 5, y: 7 } } }),
  );
  const [, tx] = await received(2);
  expect(tx).toMatchObject({
    type: "tx",
    rev: rev + 1,
    actor: "user",
    commandId: "c1",
    intent: null,
    created: [],
    deletedIds: [],
  });
  expect(tx?.type === "tx" && tx.updated).toMatchObject([{ id, transform: [1, 0, 0, 1, 5, 7] }]);

  const { changes } = (await call("zibel_doc_changes", { docId, sinceRev: rev })).structuredContent;
  expect(changes).toMatchObject([
    { rev: rev + 1, actor: "user", summary: "Transform 1 Node", updatedIds: [id] },
  ]);
  expect(changes).toHaveLength(1);
  const { nodes } = (await call("zibel_node_get", { docId, nodeIds: [id] })).structuredContent;
  expect(nodes[0].geometricBounds).toMatchObject({ x: 15, y: 17 });
});

it("commits a delete command and broadcasts the deleted ids", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const [id] = (await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] }))
    .structuredContent.createdIds;
  const { ws, received } = await subscribe(docId);
  await received(1);

  ws.send(command("c2", { type: "delete", nodeIds: [id] }));
  const [, tx] = await received(2);
  expect(tx).toMatchObject({ type: "tx", actor: "user", commandId: "c2", deletedIds: [id] });
});

it("commits an update command that hides a Node as one Transaction of the User Actor", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const { createdIds, rev } = (
    await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] })
  ).structuredContent;
  const [id] = createdIds;
  const { ws, received } = await subscribe(docId);
  await received(1);

  ws.send(command("c4", { type: "update", nodeId: id, patch: { visible: false } }));
  const [, tx] = await received(2);
  expect(tx).toMatchObject({ type: "tx", actor: "user", commandId: "c4" });
  expect(tx?.type === "tx" && tx.updated).toMatchObject([{ id, visible: false, locked: false }]);
  const { nodes } = (await call("zibel_node_get", { docId, nodeIds: [id] })).structuredContent;
  expect(nodes[0]).toMatchObject({ visible: false });
  const { changes } = (await call("zibel_doc_changes", { docId, sinceRev: rev })).structuredContent;
  expect(changes).toMatchObject([{ actor: "user", summary: "Update 1 Node", updatedIds: [id] }]);
});

it("closes the socket with 1007 on an update patch other than visible or locked", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const [id] = (await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] }))
    .structuredContent.createdIds;
  for (const patch of [{}, { name: "x" }]) {
    const { ws, received } = await subscribe(docId);
    await received(1);
    const closed = new Promise<CloseEvent>((r) => ws.addEventListener("close", r));
    ws.send(command("c5", { type: "update", nodeId: id, patch }));
    expect((await closed).code).toBe(1007);
  }
});

it("rejects a move of a Node deleted meanwhile with NODE_GONE, and commits nothing", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const [id, kept] = (
    await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId), rect(defaultLayerId)] })
  ).structuredContent.createdIds;
  const { ws, received } = await subscribe(docId);
  await received(1);
  const { rev } = (await call("zibel_node_delete", { docId, nodeIds: [id] })).structuredContent;
  await received(2);

  ws.send(
    command("c3", { type: "transform", input: { nodeIds: [kept, id], translate: { x: 1 } } }),
  );
  const [, , rejected] = await received(3);
  expect(rejected).toMatchObject({
    type: "rejected",
    id: "c3",
    error: { code: "NODE_GONE", nodeIds: [id] },
  });
  expect((await call("zibel_doc_get_info", { docId })).structuredContent.rev).toBe(rev);
});

it("closes the socket with 1007 on a message that is not a command", async () => {
  const { docId } = await newDoc();
  for (const data of ["nope", JSON.stringify({ type: "command" })]) {
    const { ws, received } = await subscribe(docId);
    await received(1);
    const closed = new Promise<CloseEvent>((r) => ws.addEventListener("close", r));
    ws.send(data);
    expect((await closed).code).toBe(1007);
  }
});

it("undoes an Agent's three-call Transaction with one undo command, and redoes it", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const { txId } = (await call("zibel_tx_begin", { docId })).structuredContent;
  const [id] = (await call("zibel_node_create", { docId, txId, nodes: [rect(defaultLayerId)] }))
    .structuredContent.createdIds;
  await call("zibel_node_update", {
    docId,
    txId,
    updates: [{ nodeId: id, patch: { name: "Box" } }],
  });
  await call("zibel_node_transform", { docId, txId, nodeIds: [id], translate: { x: 20 } });
  const { rev } = (await call("zibel_tx_commit", { docId, txId })).structuredContent;
  const { ws, received } = await subscribe(docId);
  await received(1);

  ws.send(command("u1", { type: "undo" }));
  const [, undo] = await received(2);
  expect(undo).toMatchObject({
    type: "tx",
    rev: rev + 1,
    actor: "user",
    commandId: "u1",
    deletedIds: [id],
  });
  expect(undo).not.toHaveProperty("skippedIds");
  expect(errorOf(await call("zibel_node_get", { docId, nodeIds: [id] }))).toMatchObject({
    code: "NODE_NOT_FOUND",
  });

  ws.send(command("r1", { type: "redo" }));
  const [, , redo] = await received(3);
  expect(redo).toMatchObject({
    type: "tx",
    actor: "user",
    commandId: "r1",
    created: [{ id, name: "Box" }],
  });
  const { nodes } = (await call("zibel_node_get", { docId, nodeIds: [id] })).structuredContent;
  expect(nodes[0].geometricBounds).toMatchObject({ x: 30, y: 10 });

  const { changes } = (await call("zibel_doc_changes", { docId, sinceRev: rev })).structuredContent;
  expect(changes.map((c: { actor: string; summary: string }) => [c.actor, c.summary])).toEqual([
    ["user", 'Undo "Commit 1 Node"'],
    ["user", 'Redo "Commit 1 Node"'],
  ]);
});

it("undoes a later delete first: the Node comes back with its id, then its update is undone", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const [id] = (await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] }))
    .structuredContent.createdIds;
  await call("zibel_node_update", { docId, updates: [{ nodeId: id, patch: { name: "Box" } }] });
  await call("zibel_node_delete", { docId, nodeIds: [id] });
  const { ws, received } = await subscribe(docId);
  await received(1);

  ws.send(command("u1", { type: "undo" }));
  const [, first] = await received(2);
  expect(first).toMatchObject({ created: [{ id, name: "Box" }] });
  ws.send(command("u2", { type: "undo" }));
  const [, , second] = await received(3);
  expect(second).toMatchObject({ updated: [{ id, name: "" }] });
  expect(second).not.toHaveProperty("skippedIds");
});

it("rejects undo and redo with nothing on the stack, changing nothing", async () => {
  const { docId } = await newDoc();
  const { ws, received } = await subscribe(docId);
  await received(1);
  ws.send(command("u1", { type: "undo" }));
  ws.send(command("r1", { type: "redo" }));
  const [, undo, redo] = await received(3);
  expect(undo).toMatchObject({ type: "rejected", id: "u1", error: { code: "NOTHING_TO_UNDO" } });
  expect(redo).toMatchObject({ type: "rejected", id: "r1", error: { code: "NOTHING_TO_REDO" } });
  expect((await call("zibel_doc_get_info", { docId })).structuredContent.rev).toBe(1);
});

it("clears the redo stack when a new Transaction commits", async () => {
  const { docId, defaultLayerId } = await newDoc();
  await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] });
  const { ws, received } = await subscribe(docId);
  await received(1);
  ws.send(command("u1", { type: "undo" }));
  await received(2);
  await call("zibel_node_create", { docId, nodes: [rect(defaultLayerId)] });
  await received(3);
  ws.send(command("r1", { type: "redo" }));
  const [, , , redo] = await received(4);
  expect(redo).toMatchObject({ type: "rejected", error: { code: "NOTHING_TO_REDO" } });
});
