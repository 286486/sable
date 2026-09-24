import { afterEach, expect, it, vi } from "vitest";
import { harness } from "./harness.ts";

afterEach(() => vi.restoreAllMocks());

it("calls list with no arguments and returns the list as structuredContent and as text", async () => {
  const result = {
    documents: [{ docId: "d", name: "Doc", createdAt: "2026-01-01T00:00:00Z" }],
  };
  const { service, call } = await harness({ list: async () => result });
  expect(await call("zibel_doc_list")).toEqual({
    structuredContent: result,
    content: [{ type: "text", text: JSON.stringify(result) }],
  });
  expect(service.list).toHaveBeenCalledWith();
});
