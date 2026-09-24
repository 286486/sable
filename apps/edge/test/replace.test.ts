import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { parseFile } from "@zibel/io";
import { expect, it } from "vitest";

const stub = (docId: string) => env.DOCUMENT.get(env.DOCUMENT.idFromName(docId));

const ok = <T extends object>(result: T): Exclude<T, { error: unknown }> => {
  if ("error" in result) throw new Error(JSON.stringify(result.error));
  return result as Exclude<T, { error: unknown }>;
};

const blue = { fills: [{ color: "#0000FF" }], strokes: [] };

/** A Document with three blue squares a, b, c side by side on one 200 × 100 Artboard. */
async function setup(docId: string) {
  const s = stub(docId);
  const { defaultLayerId: layer } = ok(
    await s.create({ docId, name: "Doc", artboards: [{ width: 200, height: 100 }], actor: "a" }),
  );
  const square = (x: number) => ({
    type: "rect" as const,
    parentId: layer,
    x,
    y: 0,
    width: 10,
    height: 10,
    appearance: blue,
  });
  const [a = "", b = "", c = ""] = ok(
    await s.createNodes([square(0), square(20), square(40)], "agent-a"),
  ).createdIds;
  return { s, layer, a, b, c };
}

const svgOf = async (s: ReturnType<typeof stub>, scope?: object) =>
  ok(await s.svg("agent-a", { scope } as never)).svg;

/** The element written for Node `id`. */
const element = (id: string) => new RegExp(`<[a-z]+ [^>]*\\bid="z-${id}"[^>]*/>`);
const recolour = (svg: string, id: string, color: string) =>
  svg.replace(element(id), (e) => e.replace(/fill="[^"]*"/, `fill="${color}"`));
const remove = (svg: string, id: string) => svg.replace(element(id), "");

const replace = (s: ReturnType<typeof stub>, content: string, opts = {}) =>
  s.replace(parseFile(content), "user", opts);

const fillOf = async (s: ReturnType<typeof stub>, id: string) => {
  const got = ok(await s.get([id], "full", "user")).nodes[0] as {
    appearance: { fills: { color: string }[] };
  };
  return got.appearance.fills[0]?.color;
};
const xOf = async (s: ReturnType<typeof stub>, id: string) => {
  const got = await s.get([id], "concise", "user");
  return "error" in got ? null : (got.nodes[0]?.geometricBounds?.x ?? null);
};

it("merges an edited export onto what an Agent wrote since, as one undoable Transaction", async () => {
  const { s, a, b, c } = await setup("r1");
  const svg = await svgOf(s);
  const { rev } = ok(await s.transformNodes({ nodeIds: [a], translate: { x: 5 } }, "agent-a"));

  const receipt = ok(await replace(s, remove(recolour(svg, b, "#FF0000"), c)));
  expect(receipt).toMatchObject({ rev: rev + 1, updatedIds: [b], deletedIds: [c], warnings: [] });
  expect(await xOf(s, a)).toBe(5);
  expect(await fillOf(s, b)).toBe("#FF0000");
  expect(await xOf(s, c)).toBeNull();
  expect(ok(await s.changes(rev)).changes).toMatchObject([
    { actor: "user", summary: "Replace 2 Nodes", updatedIds: [b], deletedIds: [c] },
  ]);

  ok(await s.undo("user"));
  expect(await fillOf(s, b)).toBe("#0000FF");
  expect(await xOf(s, c)).toBe(40);
  expect(await xOf(s, a)).toBe(5);
});

it("rebuilds the base across undo and redo between the export and the Replace", async () => {
  const { s, a, b } = await setup("r4");
  const svg = await svgOf(s);
  ok(await s.transformNodes({ nodeIds: [a], translate: { x: 5 } }, "agent-a"));
  ok(await s.undo("user"));
  ok(await s.transformNodes({ nodeIds: [a], translate: { x: 7 } }, "agent-a"));

  const receipt = ok(await replace(s, recolour(svg, b, "#FF0000")));
  expect(receipt).toMatchObject({ updatedIds: [b], warnings: [] });
  expect(await xOf(s, a)).toBe(7);
});

it("checks ifRev, and falls back with a warning once the log no longer reaches the base", async () => {
  const { s, b } = await setup("r9");
  const svg = await svgOf(s);
  expect(await replace(s, svg, { ifRev: 1 })).toMatchObject({ error: { code: "REV_CONFLICT" } });

  // The move after the export is past 30 days, so its delta goes with the next commit.
  ok(await s.transformNodes({ nodeIds: [b], translate: { x: 1 } }, "agent-a"));
  await runInDurableObject(s, (_, state) => {
    state.storage.sql.exec("UPDATE tx_log SET at = at - ?", 31 * 86_400_000);
  });
  ok(await s.transformNodes({ nodeIds: [b], translate: { x: 1 } }, "agent-a"));
  const receipt = ok(await replace(s, recolour(svg, b, "#FF0000")));
  expect(receipt.warnings).toEqual([expect.objectContaining({ code: "NO_BASE" })]);
  expect(await fillOf(s, b)).toBe("#FF0000");
});
