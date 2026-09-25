import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { imageId, readImage } from "@zibel/core";
import { expect, it } from "vitest";
import { RED_2x2_PNG, WEBP_HEADER } from "../../../fixtures/images.ts";

const stub = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));

const ok = <T extends object>(result: T): Exclude<T, { error: unknown }> => {
  if ("error" in result) throw new Error(JSON.stringify(result.error));
  return result as Exclude<T, { error: unknown }>;
};

async function setup(docId: string) {
  const s = stub(docId);
  const { defaultLayerId: parentId } = ok(
    await s.create({ docId, name: "Doc", artboards: [{ width: 200, height: 100 }], actor: "a" }),
  );
  const image = (src: string, extra: object = {}) =>
    ({ type: "image", parentId, src, x: 0, y: 0, ...extra }) as const;
  return { s, image };
}

const redId = () => imageId(readImage(RED_2x2_PNG, "src").bytes);
const rows = (s: ReturnType<typeof stub>) =>
  runInDurableObject(s, (_, state) => ({
    images: state.storage.sql.exec("SELECT COUNT(*) AS n FROM images").one().n,
    chunks: state.storage.sql.exec("SELECT COUNT(*) AS n FROM image_chunks").one().n,
  }));

it("stores a data URL's file once and gives its Images the file's SHA-256 as src", async () => {
  const { s, image } = await setup("images-store");
  const id = await redId();
  const receipt = ok(
    await s.createNodes([image(RED_2x2_PNG), image(RED_2x2_PNG, { x: 5 })], "agent"),
  );
  ok(await s.createNodes([image(id, { x: 10 })], "agent"));
  const { nodes } = ok(await s.get(receipt.createdIds, "full", "agent"));
  expect(nodes).toMatchObject([
    { src: id, width: 2, height: 2 },
    { src: id, x: 5 },
  ]);
  expect(JSON.stringify(nodes)).not.toContain("data:");
  expect(await rows(s)).toEqual({ images: 1, chunks: 1 });
  expect(ok(await s.image(id)).bytes).toEqual(readImage(RED_2x2_PNG, "src").bytes);
  expect(ok(await s.svg("agent", {})).svg).toContain(`xlink:href="${RED_2x2_PNG}"`);
  expect(JSON.parse(ok(await s.file("agent")).text).images).toEqual({ [id]: RED_2x2_PNG });
  expect(ok(await s.raster("agent", { scale: 1 })).svg).toContain(RED_2x2_PNG);
});

it("refuses a WebP with the reason, and with partial keeps the other items", async () => {
  const { s, image } = await setup("images-refuse");
  const { rev } = ok(await s.info());
  const refused = await s.createNodes([image(WEBP_HEADER)], "agent");
  expect(refused).toMatchObject({
    error: { code: "INVALID_IMAGE", path: "nodes[0].src", hint: expect.stringContaining("PNG") },
  });
  expect(ok(await s.info()).rev).toBe(rev);
  const bad = { type: "rect", parentId: "nope", x: 0, y: 0, width: 1, height: 1 } as const;
  const receipt = ok(
    await s.createNodes(
      [image(RED_2x2_PNG), image(WEBP_HEADER), bad, image(RED_2x2_PNG, { x: 5 })],
      "agent",
      { partial: true },
    ),
  );
  expect(receipt.createdIds).toHaveLength(2);
  expect(receipt.failed).toMatchObject([
    { index: 1, code: "INVALID_IMAGE", path: "nodes[1].src" },
    { index: 2, code: "NODE_NOT_FOUND", path: "nodes[2].parentId" },
  ]);
});

it("keeps a file over 1 MiB in chunks and reads it back whole", async () => {
  const { s, image } = await setup("images-chunks");
  const big = new Uint8Array(1.5 * 1024 * 1024);
  big.set(readImage(RED_2x2_PNG, "src").bytes);
  const receipt = ok(await s.createNodes([image(`data:image/png;base64,${big.toBase64()}`)], "a"));
  const id = await imageId(big);
  expect(ok(await s.get(receipt.createdIds, "full", "a")).nodes[0]).toMatchObject({ src: id });
  expect(await rows(s)).toEqual({ images: 1, chunks: 2 });
  expect(ok(await s.image(id)).bytes).toEqual(big);
});

it("refuses an id the Document does not hold", async () => {
  const { s, image } = await setup("images-unknown");
  expect(await s.createNodes([image("b".repeat(64))], "a")).toMatchObject({
    error: { code: "INVALID_IMAGE", path: "nodes[0].src" },
  });
  expect(await s.image("b".repeat(64))).toMatchObject({ error: { code: "INVALID_IMAGE" } });
});
