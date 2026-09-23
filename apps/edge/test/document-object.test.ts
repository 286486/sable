import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

const stub = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));

const ok = <T extends object>(result: T): Exclude<T, { error: unknown }> => {
  if ("error" in result) throw new Error(JSON.stringify(result.error));
  return result as Exclude<T, { error: unknown }>;
};

const artboards = [{ width: 200, height: 100 }];

it("keeps Nodes and the Transaction log across a DO restart, with each write's Actor", async () => {
  const created = ok(
    await stub("d1").create({ docId: "d1", name: "Doc", artboards, actor: "agent-a" }),
  );
  expect(created).toMatchObject({ docId: "d1", rev: 1 });

  const receipt = await stub("d1").createNodes(
    [
      {
        type: "rect",
        parentId: created.defaultLayerId,
        clientKey: "r",
        x: 10,
        y: 10,
        width: 50,
        height: 30,
      },
    ],
    "agent-b",
  );
  if ("error" in receipt) throw new Error(receipt.error.message);
  expect(receipt).toMatchObject({
    rev: 2,
    updatedIds: [],
    deletedIds: [],
    bounds: { x: 10, y: 10, width: 50, height: 30 },
    warnings: [],
  });
  expect(receipt.createdIds).toHaveLength(1);
  expect(receipt.keyMap).toEqual({ r: receipt.createdIds[0] });

  await evictDurableObject(stub("d1"));

  expect(await stub("d1").info()).toMatchObject({ docId: "d1", name: "Doc", rev: 2 });
  expect(await stub("d1").outline(2)).toMatchObject({
    rev: 2,
    layers: [
      { id: created.defaultLayerId, children: [{ id: receipt.createdIds[0], type: "rect" }] },
    ],
  });
  expect(await stub("d1").changes(0)).toMatchObject([
    { rev: 1, actor: "agent-a" },
    { rev: 2, actor: "agent-b", createdIds: receipt.createdIds },
  ]);
});

it("leaves rev unchanged when a write fails", async () => {
  const created = ok(
    await stub("d2").create({ docId: "d2", name: "Doc", artboards, actor: "agent-a" }),
  );
  const rect = { type: "rect" as const, x: 0, y: 0, width: 1, height: 1 };
  expect(
    await stub("d2").createNodes(
      [
        { ...rect, parentId: created.defaultLayerId },
        { ...rect, parentId: "nope" },
      ],
      "agent-a",
    ),
  ).toMatchObject({ error: { code: "NODE_NOT_FOUND", path: "nodes[1].parentId" } });
  expect(await stub("d2").info()).toMatchObject({ rev: 1 });
  expect(await stub("d2").outline(2)).toMatchObject({ layers: [{ childCount: 0 }] });
});

it("reports DOC_NOT_FOUND for a Document that was never created", async () => {
  expect(await stub("missing").info()).toMatchObject({ error: { code: "DOC_NOT_FOUND" } });
  expect(await stub("missing").outline(2)).toMatchObject({ error: { code: "DOC_NOT_FOUND" } });
});

it("logs update, transform and delete with their ids and intent, across a restart", async () => {
  const created = ok(
    await stub("d3").create({
      docId: "d3",
      name: "Doc",
      artboards,
      actor: "agent-a",
      intent: "start a poster",
    }),
  );
  const rect = { type: "rect" as const, x: 0, y: 0, width: 10, height: 10 };
  const made = ok(
    await stub("d3").createNodes([{ ...rect, parentId: created.defaultLayerId }], "agent-a", {
      intent: "draw a box",
    }),
  );
  const [id = ""] = made.createdIds;
  const updated = ok(
    await stub("d3").updateNodes([{ nodeId: id, patch: { name: "Box" } }], "agent-b", {
      intent: "make it red",
    }),
  );
  expect(updated).toMatchObject({ rev: 3, updatedIds: [id], createdIds: [], deletedIds: [] });
  expect(updated).not.toHaveProperty("failed");
  ok(await stub("d3").transformNodes({ nodeIds: [id], translate: { x: 5 } }, "agent-b"));
  // A failing write leaves rev alone; a partial one bumps it once and logs only what applied.
  expect(
    await stub("d3").updateNodes([{ nodeId: "nope", patch: { name: "x" } }], "agent-b"),
  ).toMatchObject({ error: { code: "NODE_NOT_FOUND" } });
  const partial = ok(
    await stub("d3").updateNodes(
      [
        { nodeId: id, patch: { opacity: 0.5 } },
        { nodeId: "nope", patch: {} },
      ],
      "agent-b",
      { partial: true },
    ),
  );
  expect(partial).toMatchObject({ rev: 5, updatedIds: [id], failed: [{ index: 1 }] });
  ok(await stub("d3").deleteNodes([id], "agent-b"));

  await evictDurableObject(stub("d3"));

  expect(await stub("d3").outline(2)).toMatchObject({ rev: 6, layers: [{ childCount: 0 }] });
  expect(await stub("d3").changes(0)).toEqual([
    expect.objectContaining({ rev: 1, intent: "start a poster" }),
    expect.objectContaining({ rev: 2, createdIds: [id], intent: "draw a box" }),
    expect.objectContaining({ rev: 3, actor: "agent-b", updatedIds: [id], intent: "make it red" }),
    expect.objectContaining({ rev: 4, updatedIds: [id], intent: null }),
    expect.objectContaining({ rev: 5, updatedIds: [id] }),
    expect.objectContaining({ rev: 6, deletedIds: [id], createdIds: [], updatedIds: [] }),
  ]);
});
