import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

const stub = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));

const artboards = [{ name: "A", frame: { x: 0, y: 0, width: 200, height: 100 } }];

it("keeps a created Document and its Transaction log across a DO restart", async () => {
  const created = await stub("d1").create({
    docId: "d1",
    name: "Doc",
    artboards,
    actor: "agent-a",
  });
  expect(created).toMatchObject({ docId: "d1", rev: 1 });

  await evictDurableObject(stub("d1"));

  expect(await stub("d1").info()).toMatchObject({ docId: "d1", name: "Doc", rev: 1 });
  expect(await stub("d1").changes(0)).toMatchObject([{ rev: 1, actor: "agent-a" }]);
});

it("reports DOC_NOT_FOUND for a Document that was never created", async () => {
  expect(await stub("missing").info()).toMatchObject({ error: { code: "DOC_NOT_FOUND" } });
});
