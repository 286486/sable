import { afterEach, describe, expect, it, vi } from "vitest";
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

const receipt = {
  txId: "t",
  rev: 2,
  createdIds: [],
  updatedIds: [],
  deletedIds: [],
  keyMap: {},
  bounds: null,
  warnings: [],
};
const opts = { intent: "why", txId: "t", ifRev: 3 };

describe("write tools pass the write and its options apart", () => {
  it("node_create: every type through the published union, with the schema defaults filled", async () => {
    const { service, call } = await harness({ createNodes: async () => receipt });
    const nodes = [
      { type: "layer", name: "L" },
      { type: "group", parentId: "p", children: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] },
      { type: "rect", parentId: "p", x: 0, y: 0, width: 10, height: 10 },
      { type: "ellipse", parentId: "p", x: 0, y: 0, width: 10, height: 10 },
      { type: "polygon", parentId: "p", cx: 0, cy: 0, radius: 5, sides: 6 },
      { type: "star", parentId: "p", cx: 0, cy: 0, outerRadius: 5, innerRadius: 2, points: 5 },
      { type: "path", parentId: "p", d: "M 0 0 L 1 1" },
      { type: "text", parentId: "p", x: 0, y: 0, content: "Hi" },
    ];
    const result = await call("zibel_node_create", { docId: "d", nodes, ...opts });
    expect(result.structuredContent).toEqual(receipt);
    const [docId, sent, options] = service.createNodes.mock.calls[0] ?? [];
    expect(docId).toBe("d");
    expect(options).toEqual({ ...opts, partial: false });
    expect(sent).toMatchObject([
      { type: "layer", parentId: null },
      { type: "group", children: [{ type: "line" }] },
      { type: "rect", radius: 0 },
      { type: "ellipse" },
      { type: "polygon" },
      { type: "star" },
      { type: "path", fillRule: "nonzero" },
      { type: "text", kind: "point", fontFamily: "Source Sans 3", fontSize: 12 },
    ]);
    await call("zibel_node_create", { docId: "d", nodes: [nodes[2]] });
    expect(service.createNodes.mock.calls[1]?.[2]).toEqual({ partial: false });
  });

  it("node_update: each patch arrives as sent, with no Node or Stroke defaults", async () => {
    const { service, call } = await harness({ updateNodes: async () => receipt });
    const updates = [
      { nodeId: "a", patch: { width: 60 } },
      { nodeId: "b", patch: { appearance: { fills: [{ color: "#FF0000" }] } } },
    ];
    await call("zibel_node_update", { docId: "d", updates, ...opts });
    // A Fill is always solid so far; the list replaces, and strokes is not sent.
    const fills = [{ type: "solid", color: "#FF0000" }];
    expect(service.updateNodes).toHaveBeenCalledWith(
      "d",
      [updates[0], { nodeId: "b", patch: { appearance: { fills } } }],
      { ...opts, partial: false },
    );
  });

  it("node_delete", async () => {
    const { service, call } = await harness({ deleteNodes: async () => receipt });
    await call("zibel_node_delete", { docId: "d", nodeIds: ["a", "b"], ...opts });
    expect(service.deleteNodes).toHaveBeenCalledWith("d", ["a", "b"], {
      ...opts,
      partial: false,
    });
  });

  it("node_transform: the transform gets none of the write options", async () => {
    const { service, call } = await harness({ transformNodes: async () => receipt });
    await call("zibel_node_transform", {
      docId: "d",
      nodeIds: ["a"],
      rotate: 90,
      partial: true,
      ...opts,
    });
    expect(service.transformNodes).toHaveBeenCalledWith(
      "d",
      { nodeIds: ["a"], rotate: 90, pivot: "center", each: false, scaleStrokes: true },
      { ...opts, partial: true },
    );
  });

  it("doc_replace: content, baseRev, ifRev and intent; no txId or partial", async () => {
    const { service, call } = await harness({ replace: async () => receipt });
    await call("zibel_doc_replace", {
      docId: "d",
      content: "<svg/>",
      baseRev: 3,
      ifRev: 4,
      intent: "i",
    });
    expect(service.replace).toHaveBeenCalledWith("d", {
      content: "<svg/>",
      baseRev: 3,
      ifRev: 4,
      intent: "i",
    });
  });

  it("svg_import: fit defaults to false; no name or partial", async () => {
    const placed = { ...receipt, nodes: [] };
    const { service, call } = await harness({ place: async () => placed });
    const position = { x: 1, y: 2 };
    const result = await call("zibel_svg_import", {
      docId: "d",
      svg: "<svg/>",
      parentId: "p",
      position,
      ...opts,
    });
    expect(result.structuredContent).toEqual(placed);
    expect(service.place).toHaveBeenCalledWith("d", {
      svg: "<svg/>",
      parentId: "p",
      position,
      fit: false,
      ...opts,
    });
  });

  it("doc_create and doc_open", async () => {
    const created = { docId: "d", defaultLayerId: "l", artboards: [], rev: 1 };
    const opened = { docId: "d", name: "Doc", artboards: [], rev: 1, nodes: [], warnings: [] };
    const { service, call } = await harness({
      create: async () => created,
      open: async () => opened,
    });
    await call("zibel_doc_create", {
      name: "Doc",
      artboards: [{ x: 0, width: 10, height: 10 }],
      intent: "i",
    });
    expect(service.create).toHaveBeenCalledWith({
      name: "Doc",
      artboards: [expect.objectContaining({ x: 0, y: 0, width: 10, height: 10 })],
      intent: "i",
    });
    await call("zibel_doc_open", { content: "{}", intent: "i" });
    expect(service.open).toHaveBeenCalledWith({ content: "{}", intent: "i" });
  });

  it("tx_begin, tx_commit and tx_rollback", async () => {
    const tx = { txId: "t", rev: 1 };
    const { service, call } = await harness({
      begin: async () => tx,
      commitTx: async () => receipt,
      rollback: async () => tx,
    });
    await call("zibel_tx_begin", { docId: "d", label: "Label" });
    await call("zibel_tx_begin", { docId: "d" });
    expect(service.begin.mock.calls).toEqual([
      ["d", "Label"],
      ["d", undefined],
    ]);
    await call("zibel_tx_commit", { docId: "d", ...opts });
    expect(service.commitTx).toHaveBeenCalledWith("d", "t", { ifRev: 3, intent: "why" });
    await call("zibel_tx_rollback", { docId: "d", txId: "t" });
    expect(service.rollback).toHaveBeenCalledWith("d", "t");
  });
});
