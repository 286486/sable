import { afterEach, expect, it, vi } from "vitest";
import { call } from "./rpc.ts";

afterEach(() => vi.restoreAllMocks());

const logged = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.flatMap(([line]) => {
    try {
      return [JSON.parse(String(line))];
    } catch {
      return [];
    }
  });

it("logs one structured line per tool call with Actor, tool, duration, node count, error code and rev", async () => {
  const doc = (
    await call("zibel_doc_create", { name: "Doc", artboards: [{ width: 10, height: 10 }] })
  ).structuredContent;
  const spy = vi.spyOn(console, "log");
  await call(
    "zibel_node_create",
    {
      docId: doc.docId,
      nodes: [{ type: "rect", parentId: doc.defaultLayerId, x: 0, y: 0, width: 1, height: 1 }],
    },
    "dev-token-b",
  );
  await call("zibel_doc_outline", { docId: "01NOPE" });
  expect(logged(spy)).toEqual([
    {
      actor: "agent-b",
      tool: "zibel_node_create",
      ms: expect.any(Number),
      nodes: 1,
      code: null,
      rev: 2,
    },
    {
      actor: "agent-a",
      tool: "zibel_doc_outline",
      ms: expect.any(Number),
      nodes: 0,
      code: "DOC_NOT_FOUND",
      rev: null,
    },
  ]);
});
