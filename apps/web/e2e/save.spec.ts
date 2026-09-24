import { expect, test } from "@playwright/test";
import { call } from "./mcp.ts";

test("the download button saves the .zibel.json that export returns and doc_open accepts", async ({
  page,
  request,
}) => {
  const { docId, defaultLayerId } = (
    await call(request, "zibel_doc_create", {
      name: "E2E",
      artboards: [{ width: 200, height: 100 }],
    })
  ).structuredContent;
  await call(request, "zibel_node_create", {
    docId,
    nodes: [{ type: "rect", parentId: defaultLayerId, x: 75, y: 25, width: 50, height: 50 }],
  });

  await page.goto(`/docs/${docId}`);
  await expect(page.locator("body")).toContainText(/\d+%/);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .zibel.json" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("E2E.zibel.json");
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk;
  const exported = await call(request, "zibel_export", { docId, format: "zibel_json" });
  expect(text).toBe(exported.content[0].text);

  const opened = await call(request, "zibel_doc_open", { content: text });
  expect(opened.structuredContent).toMatchObject({ name: "E2E", rev: 1 });
});

test("Download SVG saves the Inkscape SVG that export returns at that rev", async ({
  page,
  request,
}) => {
  const { docId, defaultLayerId } = (
    await call(request, "zibel_doc_create", {
      name: "E2E",
      artboards: [
        { width: 200, height: 100 },
        { width: 50, height: 50, background: "#FFEEDD" },
      ],
    })
  ).structuredContent;
  await call(request, "zibel_node_create", {
    docId,
    nodes: [
      { type: "rect", parentId: defaultLayerId, x: 75, y: 25, width: 50, height: 50, radius: 5 },
      {
        type: "star",
        parentId: defaultLayerId,
        cx: 30,
        cy: 30,
        outerRadius: 20,
        innerRadius: 8,
        points: 5,
      },
      { type: "text", parentId: defaultLayerId, x: 10, y: 90, content: "Hi & bye" },
    ],
  });

  await page.goto(`/docs/${docId}`);
  await expect(page.locator("body")).toContainText(/\d+%/);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download SVG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("E2E.svg");
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk;
  const exported = await call(request, "zibel_export", { docId, format: "svg" });
  expect(text).toBe(exported.content[0].text);
});
