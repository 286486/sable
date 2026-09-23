import { expect, it } from "vitest";
import { call, errorOf } from "./rpc.ts";

type Rect = { x: number; y: number; width: number; height: number };

const newDoc = async (artboards: object[] = [{ width: 200, height: 100 }]) =>
  (await call("zibel_doc_create", { name: "Doc", artboards })).structuredContent as {
    docId: string;
    defaultLayerId: string;
    artboards: { id: string; frame: Rect }[];
  };

/** The width and height a PNG's IHDR chunk declares. */
function pngSize(result: { content: { type: string; data?: string; mimeType?: string }[] }) {
  const image = result.content.find((c) => c.type === "image");
  expect(image?.mimeType).toBe("image/png");
  const png = Uint8Array.from(atob(image?.data ?? ""), (c) => c.charCodeAt(0));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const ihdr = new DataView(png.buffer, 16, 8);
  return { width: ihdr.getUint32(0), height: ihdr.getUint32(4) };
}

/** Renders, and checks the PNG is as large as the viewport says. */
async function render(args: object) {
  const result = await call("zibel_render", args);
  expect(result.isError).toBeFalsy();
  expect(pngSize(result)).toEqual(result.structuredContent.viewport.pixelSize);
  return result.structuredContent.viewport;
}

const redRect = (parentId: string) => ({
  type: "rect",
  parentId,
  x: 10,
  y: 10,
  width: 50,
  height: 30,
  appearance: { fills: [{ color: "#FF0000" }], strokes: [{ color: "#000000", width: 4 }] },
});

it("renders the Document to a PNG with viewport metadata", async () => {
  const doc = await newDoc();
  await call("zibel_node_create", { docId: doc.docId, nodes: [redRect(doc.defaultLayerId)] });
  expect(await render({ docId: doc.docId, scale: 2 })).toEqual({
    docRect: { x: 0, y: 0, width: 200, height: 100 },
    pixelSize: { width: 400, height: 200 },
    scale: 2,
  });
});

it("renders each Render Scope at the pixel size and docRect it covers", async () => {
  const doc = await newDoc([
    { width: 200, height: 100 },
    { width: 50, height: 40 },
  ]);
  const rectId = (
    await call("zibel_node_create", { docId: doc.docId, nodes: [redRect(doc.defaultLayerId)] })
  ).structuredContent.createdIds[0];
  const second = doc.artboards[1];
  expect(await render({ docId: doc.docId, scope: { artboardId: second?.id } })).toEqual({
    docRect: second?.frame,
    pixelSize: { width: 50, height: 40 },
    scale: 1,
  });
  // The rect's visibleBounds: its 4 pt Stroke reaches 2 pt past each side.
  expect(await render({ docId: doc.docId, scope: { nodeIds: [rectId] }, scale: 2 })).toEqual({
    docRect: { x: 8, y: 8, width: 54, height: 34 },
    pixelSize: { width: 108, height: 68 },
    scale: 2,
  });
  // Widened to whole pixels, so docX = docRect.x + px / scale stays exact.
  expect(
    await render({
      docId: doc.docId,
      scope: { rect: { x: 1, y: 2, width: 10.2, height: 10 } },
      scale: 2,
    }),
  ).toEqual({
    docRect: { x: 1, y: 2, width: 10.5, height: 10 },
    pixelSize: { width: 21, height: 20 },
    scale: 2,
  });
});

it("lowers the scale to fit maxSize and reports the scale used", async () => {
  const doc = await newDoc([{ width: 2000, height: 100 }]);
  expect(await render({ docId: doc.docId })).toEqual({
    docRect: { x: 0, y: 0, width: 2000, height: 100 },
    pixelSize: { width: 1600, height: 80 },
    scale: 0.8,
  });
  expect((await render({ docId: doc.docId, maxSize: 500 })).pixelSize).toEqual({
    width: 500,
    height: 25,
  });
});

it("refuses an image larger than 4096 px per side with LIMIT_EXCEEDED and a hint", async () => {
  const { docId } = await newDoc([{ width: 2000, height: 100 }]);
  expect(errorOf(await call("zibel_render", { docId, scale: 4, maxSize: 8000 }))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    path: "maxSize",
    hint: expect.stringContaining("4096"),
  });
  expect(errorOf(await call("zibel_export", { docId, format: "png", scale: 4 }))).toMatchObject({
    code: "LIMIT_EXCEEDED",
    path: "scale",
    hint: expect.stringContaining("scale <= 2.04"),
  });
});

it("answers a scope that names nothing with an error and its path", async () => {
  const doc = await newDoc();
  const groupId = (
    await call("zibel_node_create", {
      docId: doc.docId,
      nodes: [{ type: "group", parentId: doc.defaultLayerId, children: [] }],
    })
  ).structuredContent.createdIds[0];
  const err = async (args: object) =>
    errorOf(await call("zibel_render", { docId: doc.docId, ...args }));
  expect(await err({ scope: { artboardId: "nope" } })).toMatchObject({
    code: "ARTBOARD_NOT_FOUND",
    path: "scope.artboardId",
  });
  expect(await err({ scope: { nodeIds: [groupId, "nope"] } })).toMatchObject({
    code: "NODE_NOT_FOUND",
    path: "scope.nodeIds[1]",
  });
  expect(await err({ scope: { nodeIds: [groupId] } })).toMatchObject({ code: "NOTHING_TO_RENDER" });
  expect(await err({ background: "red" })).toMatchObject({
    code: "INVALID_COLOR",
    path: "background",
  });
});

it("draws overlays and a background into the image, at the same size", async () => {
  const doc = await newDoc();
  await call("zibel_node_create", { docId: doc.docId, nodes: [redRect(doc.defaultLayerId)] });
  const png = async (args: object) => {
    const result = await call("zibel_render", { docId: doc.docId, ...args });
    expect(pngSize(result)).toEqual({ width: 200, height: 100 });
    return result.content[0].data;
  };
  const plain = await png({});
  for (const overlay of ["bounds", "ids", "artboards"]) {
    expect(await png({ overlays: [overlay] })).not.toBe(plain);
  }
  expect(await png({ background: "#112233" })).not.toBe(plain);
});

it("exports a known scene as SVG text that matches the stored file", async () => {
  const doc = await newDoc([{ width: 200, height: 100, background: "#FFFFFF" }]);
  await call("zibel_node_create", {
    docId: doc.docId,
    nodes: [
      redRect(doc.defaultLayerId),
      { type: "text", parentId: doc.defaultLayerId, x: 80, y: 40, content: "Hi" },
      {
        type: "group",
        parentId: doc.defaultLayerId,
        children: [{ type: "line", x1: 100, y1: 60, x2: 180, y2: 90 }],
      },
    ],
  });
  const result = await call("zibel_export", { docId: doc.docId, format: "svg" });
  expect(result.structuredContent).toEqual({ docRect: { x: 0, y: 0, width: 200, height: 100 } });
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  await expect(result.content[0].text).toMatchFileSnapshot("./fixtures/export-scene.svg");
});

it("exports PNG as image content with its viewport, in the same scopes", async () => {
  const doc = await newDoc();
  const rectId = (
    await call("zibel_node_create", { docId: doc.docId, nodes: [redRect(doc.defaultLayerId)] })
  ).structuredContent.createdIds[0];
  const result = await call("zibel_export", {
    docId: doc.docId,
    format: "png",
    scope: { nodeIds: [rectId] },
    scale: 2,
  });
  expect(result.structuredContent).toEqual({
    viewport: {
      docRect: { x: 8, y: 8, width: 54, height: 34 },
      pixelSize: { width: 108, height: 68 },
      scale: 2,
    },
  });
  expect(pngSize(result)).toEqual({ width: 108, height: 68 });
});
