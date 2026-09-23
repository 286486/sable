import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

const stub = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));

const artboards = [{ width: 200, height: 100 }];

it("keeps Nodes and the Transaction log across a DO restart, with each write's Actor", async () => {
  const created = await stub("d1").create({
    docId: "d1",
    name: "Doc",
    artboards,
    actor: "agent-a",
  });
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
  const created = await stub("d2").create({
    docId: "d2",
    name: "Doc",
    artboards,
    actor: "agent-a",
  });
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
