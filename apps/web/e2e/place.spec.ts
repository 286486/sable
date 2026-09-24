import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { call } from "./mcp.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="10"/></svg>';

/** A 200 × 100 Document open in the page; the viewer fits its Artboard to the page's centre. */
async function open(page: Page, request: APIRequestContext) {
  const { docId, defaultLayerId } = (
    await call(request, "zibel_doc_create", {
      name: "E2E",
      artboards: [{ width: 200, height: 100 }],
    })
  ).structuredContent;
  await page.goto(`/docs/${docId}`);
  await expect(page.locator("body")).toContainText(/\d+%/);
  return { docId, defaultLayerId };
}

/** The Groups in the Layer, with their bounds. */
const groups = async (request: APIRequestContext, docId: string, layerId: string) =>
  (await call(request, "zibel_doc_outline", { docId, rootId: layerId, depth: 1 })).structuredContent
    .nodes as { id: string; name: string; type: string; bounds: { x: number; y: number } }[];

test("pasting SVG text places it as a Group centred in the viewport, as the user", async ({
  page,
  request,
}) => {
  const { docId, defaultLayerId } = await open(page, request);
  // Pan right by 20 pt, so the viewport centre is no longer the Artboard's.
  const scale = Number((await page.locator("body").innerText()).match(/(\d+)%/)?.[1]) / 100;
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  const [cx, cy] = [size.width / 2, size.height / 2];
  await page.keyboard.down("Space");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20 * scale, cy, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, SVG);

  await expect.poll(async () => (await groups(request, docId, defaultLayerId)).length).toBe(1);
  const [group] = await groups(request, docId, defaultLayerId);
  expect(group?.type).toBe("group");
  // Centred on (80, 50): the Artboard's centre, less the pan. Zoom text rounds the scale.
  expect(group?.bounds.x).toBeCloseTo(70, 0);
  expect(group?.bounds.y).toBeCloseTo(45, 1);
  const { changes } = (await call(request, "zibel_doc_changes", { docId, sinceRev: 1 }))
    .structuredContent;
  expect(changes).toMatchObject([
    { actor: "user", createdIds: expect.arrayContaining([group?.id]) },
  ]);
});

test("dropping an .svg file on the canvas places it, named after the file", async ({
  page,
  request,
}) => {
  const { docId, defaultLayerId } = await open(page, request);
  await page.locator("canvas").evaluate((canvas, text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], "Logo.svg", { type: "image/svg+xml" }));
    canvas.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true }));
  }, SVG);

  await expect.poll(async () => (await groups(request, docId, defaultLayerId)).length).toBe(1);
  const [group] = await groups(request, docId, defaultLayerId);
  expect(group).toMatchObject({ type: "group", name: "Logo", bounds: { x: 90, y: 45 } });
});
