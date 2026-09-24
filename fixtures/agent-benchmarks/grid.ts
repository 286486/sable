import { assert, type Bounds, type Check, n3 } from "./mcp.ts";

const check: Check = async (call, docId) => {
  const { nodes: layers } = (await call("zibel_doc_outline", { docId, depth: 1 }))
    .structuredContent as { nodes: { id: string; name: string }[] };
  const layer = layers.find((l) => l.name === "Grid");
  assert(layer, `no top-level Layer named "Grid" (found ${layers.map((l) => l.name)})`);

  const { nodes: all } = (await call("zibel_node_query", { docId, limit: 1000 }))
    .structuredContent as {
    nodes: { id: string; type: string; parentId: string | null; geometricBounds: Bounds }[];
  };
  const parent = new Map(all.map((n) => [n.id, n.parentId]));
  // Groups inside the Layer are fine: the Skill document asks for them.
  const inGrid = (id: string | null | undefined): boolean =>
    id === layer.id || (id != null && inGrid(parent.get(id)));
  const shapes = all.filter((n) => n.type !== "layer" && n.type !== "group");
  const rects = shapes.filter((n) => n.type === "rect" && inGrid(n.parentId));
  assert(
    rects.length === 100 && shapes.length === 100,
    `${rects.length} rects in Grid, ${shapes.length} shapes in the Document; want 100 and 100`,
  );

  const cells = new Set<string>();
  for (const { geometricBounds: b } of rects) {
    assert(n3(b.width) === 40 && n3(b.height) === 40, `a rect is ${b.width}×${b.height}`);
    cells.add(`${n3(b.x)},${n3(b.y)}`);
  }
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const cell = `${50 + 50 * i},${50 + 50 * j}`;
      assert(cells.has(cell), `no rect at ${cell}`);
    }

  const { nodes: full } = (
    await call("zibel_node_get", { docId, nodeIds: rects.map((r) => r.id), detail: "full" })
  ).structuredContent as {
    nodes: { id: string; appearance: { fills: { color: string }[]; strokes: unknown[] } }[];
  };
  for (const { id, appearance: a } of full)
    assert(
      a.fills.length === 1 &&
        a.fills[0]?.color.toUpperCase() === "#3366CC" &&
        a.strokes.length === 0,
      `${id} has appearance ${JSON.stringify(a)}`,
    );

  const svg = (await call("zibel_export", { docId, format: "svg" })).content[0]?.text ?? "";
  const paths = svg.split("<path").length - 1;
  assert(paths === 100, `the SVG export has ${paths} <path>, want 100`);
};

export default check;
