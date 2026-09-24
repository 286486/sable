import { describe, expect, it } from "vitest";
import grid from "../../../fixtures/agent-benchmarks/grid.ts";
import type { Call } from "../../../fixtures/agent-benchmarks/mcp.ts";
import { call as rpcCall } from "./rpc.ts";

/** The benchmark assertions' Call, through the Worker; a failed call throws, as over HTTP. */
const call: Call = async (name, args) => {
  const result = await rpcCall(name, args);
  if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
  return result;
};

const newDoc = async (width: number, height: number) =>
  (await call("zibel_doc_create", { name: "Bench", artboards: [{ width, height }] }))
    .structuredContent as { docId: string; defaultLayerId: string };

const layer = async (docId: string, name: string) =>
  (await call("zibel_node_create", { docId, nodes: [{ type: "layer", name }] })).structuredContent
    .createdIds[0] as string;

describe("grid", () => {
  const draw = async (count: number) => {
    const { docId } = await newDoc(600, 600);
    const parentId = await layer(docId, "Grid");
    const nodes = Array.from({ length: count }, (_, k) => ({
      type: "rect",
      parentId,
      x: 50 + 50 * (k % 10),
      y: 50 + 50 * Math.floor(k / 10),
      width: 40,
      height: 40,
      appearance: { fills: [{ color: "#3366cc" }] },
    }));
    await call("zibel_node_create", { docId, nodes });
    return docId;
  };

  it("accepts 100 rects in the Grid Layer", async () => {
    await expect(grid(call, await draw(100), [])).resolves.toBeUndefined();
  });

  it("rejects 99 rects", async () => {
    await expect(grid(call, await draw(99), [])).rejects.toThrow("99 rects");
  });
});
