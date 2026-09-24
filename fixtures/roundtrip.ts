// `pnpm roundtrip`: each fixture Document goes Zibel → SVG → Inkscape → Zibel through a local
// `wrangler dev` and must come back equal (ADR-0017, REQUIREMENTS §7.2). Needs `inkscape` ≥ 1.2.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { httpCall } from "./agent-benchmarks/mcp.ts";
import { startServer } from "./wrangler.ts";

const PORT = 8791;
const STATE = ".wrangler/roundtrip";
const FIXTURES = join(import.meta.dirname, "documents");

interface Doc {
  name: string;
  artboards: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
}

function inkscape(...args: string[]) {
  const run = spawnSync("inkscape", args, { encoding: "utf8" });
  if (run.error) throw run.error;
  // Inkscape writes Gtk warnings to stderr on every call, so only the exit code tells.
  if (run.status !== 0) throw new Error(`inkscape ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

/** The first way `got` differs from `want`, naming the field; undefined when equal. */
function firstDifference(want: Doc, got: Doc): string | undefined {
  const show = JSON.stringify;
  const fields = (path: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (key !== "index" && show(a[key]) !== show(b[key]))
        return `${path}.${key}: ${show(b[key])}, want ${show(a[key])}`;
  };
  if (want.name !== got.name) return `name: ${show(got.name)}, want ${show(want.name)}`;
  if (want.artboards.length !== got.artboards.length)
    return `artboards: ${got.artboards.length}, want ${want.artboards.length}`;
  for (const [i, a] of want.artboards.entries()) {
    const diff = fields(`artboards[${i}]`, a, got.artboards[i] ?? {});
    if (diff) return diff;
  }
  const byId = new Map(got.nodes.map((n) => [n.id, n]));
  for (const a of want.nodes) {
    const b = byId.get(a.id);
    if (!b) return `nodes[${a.id}]: missing`;
    const diff = fields(`nodes[${a.id}]`, a, b);
    if (diff) return diff;
  }
  const extra = got.nodes.find((n) => !want.nodes.some((a) => a.id === n.id));
  if (extra) return `nodes[${extra.id}]: not in the original`;
  // Fractional indexes may be renumbered; only the order of each parent's children must hold.
  const order = (doc: Doc, parentId: unknown) =>
    doc.nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => ((a.index as string) < (b.index as string) ? -1 : 1))
      .map((n) => n.id);
  for (const parentId of new Set(want.nodes.map((n) => n.parentId))) {
    const [a, b] = [order(want, parentId), order(got, parentId)];
    if (show(a) !== show(b)) return `children of ${parentId}: ${show(b)}, want ${show(a)}`;
  }
}

async function main() {
  const version = spawnSync("inkscape", ["--version"], { encoding: "utf8" });
  if ((version.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    console.log("roundtrip: skipped, inkscape is not on PATH");
    return 0;
  }
  const [, major = 0, minor = 0] =
    /Inkscape (\d+)\.(\d+)/.exec(version.stdout ?? "")?.map(Number) ?? [];
  if (major < 1 || (major === 1 && minor < 2)) {
    console.log(
      `roundtrip: needs Inkscape ≥ 1.2, found ${version.stdout?.trim() || version.error}`,
    );
    return 1;
  }

  const server = await startServer(PORT, STATE);
  let failed = 0;
  try {
    const call = httpCall(`http://127.0.0.1:${PORT}/mcp`, "dev-token-a");
    const open = async (content: string) =>
      (await call("zibel_doc_open", { content })).structuredContent as {
        docId: string;
        name: string;
        warnings: unknown[];
      };
    const text = async (args: object) => (await call("zibel_export", args)).content[0]?.text ?? "";
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".zibel.json"))) {
      const fixture = file.slice(0, -".zibel.json".length);
      const dir = join(STATE, fixture);
      mkdirSync(join(dir, "inkscape"), { recursive: true });
      let error: string | undefined;
      try {
        const original = await open(readFileSync(join(FIXTURES, file), "utf8"));
        // Inkscape names the Document after the file it reads, and Open reads the name back from it.
        const exported = join(dir, `${original.name}.svg`);
        writeFileSync(exported, await text({ docId: original.docId, format: "svg" }));
        const saved = join(dir, "inkscape", `${original.name}.svg`);
        inkscape("--export-type=svg", `--export-filename=${saved}`, exported);
        const reopened = await open(readFileSync(saved, "utf8"));
        if (reopened.warnings.length)
          throw new Error(`warnings: ${JSON.stringify(reopened.warnings)}`);
        const [want, got] = await Promise.all(
          [original, reopened].map(
            async (d) => JSON.parse(await text({ docId: d.docId, format: "zibel_json" })) as Doc,
          ),
        );
        error = firstDifference(want, got);
      } catch (e) {
        error = (e as Error).message;
      }
      if (error) failed++;
      console.log([fixture.padEnd(12), error ? `FAIL  ${error}` : "pass"].join("  "));
    }
  } finally {
    server.stop();
  }
  return failed ? 1 : 0;
}

process.exit(await main());
