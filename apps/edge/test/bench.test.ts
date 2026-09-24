import { describe, expect, it } from "vitest";
import grid from "../../../fixtures/agent-benchmarks/grid.ts";
import labels from "../../../fixtures/agent-benchmarks/labels.ts";
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

describe("labels", () => {
  const draw = async (circleLabelX: number) => {
    const { docId, defaultLayerId: parentId } = await newDoc(600, 200);
    const text = (content: string, x: number) => ({ type: "text", parentId, x, y: 105, content });
    await call("zibel_node_create", {
      docId,
      nodes: [
        { type: "ellipse", parentId, x: 20, y: 70, width: 60, height: 60 },
        { type: "rect", parentId, x: 200, y: 70, width: 60, height: 60 },
        { type: "polygon", parentId, cx: 430, cy: 100, radius: 35, sides: 3 },
        text("Circle", circleLabelX),
        text("Square", 270),
        text("Triangle", 470),
      ],
    });
    return docId;
  };

  it("accepts a label right of each shape", async () => {
    await expect(labels(call, await draw(90), [])).resolves.toBeUndefined();
  });

  it("rejects a label overlapping its shape", async () => {
    await expect(labels(call, await draw(40), [])).rejects.toThrow('"Circle" overlaps the ellipse');
  });
});
