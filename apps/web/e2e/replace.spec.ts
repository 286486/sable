import { expect, test } from "@playwright/test";
import { call } from "./mcp.ts";

test("Update from file… merges an edited SVG export into the open Document as the user", async ({
  page,
  request,
}) => {
  const { docId, defaultLayerId } = (
    await call(request, "zibel_doc_create", {
      name: "E2E",
      artboards: [{ width: 200, height: 100 }],
    })
  ).structuredContent;
  const created = await call(request, "zibel_node_create", {
    docId,
    nodes: [
      {
        type: "rect",
        parentId: defaultLayerId,
        x: 75,
        y: 25,
        width: 50,
        height: 50,
        appearance: { fills: [{ color: "#0000FF" }], strokes: [] },
      },
    ],
  });
  const [id] = created.structuredContent.createdIds as string[];
  const svg = (await call(request, "zibel_export", { docId, format: "svg" })).content[0]
    .text as string;

  await page.goto(`/docs/${docId}`);
  await expect(page.locator("body")).toContainText(/\d+%/);
  // Chosen in the page, as a file picker would: the e2e tsconfig has no Node Buffer.
  const edited = svg.replace('fill="#0000FF"', 'fill="#FF0000"');
  await page.getByLabel("Update from file…").evaluate((input: HTMLInputElement, text) => {
    const files = new DataTransfer();
    files.items.add(new File([text], "E2E.svg", { type: "image/svg+xml" }));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, edited);

  await expect
    .poll(async () => {
      const got = await call(request, "zibel_node_get", { docId, nodeIds: [id], detail: "full" });
      return got.structuredContent.nodes[0].appearance.fills[0].color;
    })
    .toBe("#FF0000");
  const { changes } = (await call(request, "zibel_doc_changes", { docId, sinceRev: 2 }))
    .structuredContent;
  expect(changes).toMatchObject([{ actor: "user", updatedIds: [id] }]);
});
