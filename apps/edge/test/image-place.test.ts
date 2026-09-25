import { expect, it } from "vitest";
import { RED_2x2_PNG } from "../../../fixtures/images.ts";
import { call, errorOf } from "./rpc.ts";

const newDoc = async () =>
  (await call("zibel_doc_create", { name: "Doc", artboards: [{ width: 200, height: 100 }] }))
    .structuredContent as { docId: string; defaultLayerId: string };

it("places a data URL centred on the parent's Artboard, and never echoes the bytes", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const placed = await call("zibel_image_place", {
    docId,
    src: RED_2x2_PNG,
    parentId: defaultLayerId,
  });
  expect(placed.isError).toBeFalsy();
  const { createdIds } = placed.structuredContent;
  expect(createdIds).toHaveLength(1);
  const got = await call("zibel_node_get", { docId, nodeIds: createdIds, detail: "full" });
  expect(got.structuredContent.nodes).toMatchObject([
    {
      type: "image",
      x: 99,
      y: 49,
      width: 2,
      height: 2,
      src: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  ]);
  expect(JSON.stringify([placed, got])).not.toContain("data:");
});

it("asTemplate puts it at 50% on a locked Template Layer beneath the parent's Layer", async () => {
  const { docId, defaultLayerId } = await newDoc();
  const placed = await call("zibel_image_place", {
    docId,
    src: RED_2x2_PNG,
    parentId: defaultLayerId,
    asTemplate: true,
  });
  const [layerId, imageId] = placed.structuredContent.createdIds;
  const outline = await call("zibel_doc_outline", { docId, depth: 1 });
  expect(outline.structuredContent.nodes).toMatchObject([
    { id: layerId, type: "layer", name: "Template Image", locked: true, childCount: 1 },
    { id: defaultLayerId },
  ]);
  const got = await call("zibel_node_get", { docId, nodeIds: [imageId], detail: "full" });
  expect(got.structuredContent.nodes).toMatchObject([
    { type: "image", parentId: layerId, opacity: 0.5 },
  ]);
});

it.each(["file:///tmp/a.png", "/tmp/a.png"])(
  "refuses %s, since the server cannot read the Agent's disk",
  async (src) => {
    const { docId, defaultLayerId } = await newDoc();
    const result = await call("zibel_image_place", { docId, src, parentId: defaultLayerId });
    expect(errorOf(result)).toMatchObject({
      code: "INVALID_IMAGE",
      path: "src",
      hint: expect.stringContaining("data:"),
    });
  },
);
