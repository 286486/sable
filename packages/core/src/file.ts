import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { parseColor } from "./color.ts";
import { assertParent, paint } from "./document.ts";
import { zodPath } from "./edit.ts";
import { ZibelError } from "./errors.ts";
import { formatPath, parsePath } from "./path.ts";
import {
  type AppearanceInput,
  type Artboard,
  type Document,
  Fill,
  type Node,
  Rect,
  SHAPES,
  Stroke,
  TextShape,
  Writable,
} from "./schema.ts";

/** Upgrades the raw JSON of one schema version to the next, before validation (F-DOC-06). */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[n - 1]` upgrades version n to n + 1; the current version is one past the last. */
export const MIGRATIONS: Migration[] = [];

/** Every object's keys sorted, recursively; arrays keep their order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  );
}

/**
 * The Document as `.zibel.json` (ADR-0016): the same Document always gives the same text. No docId,
 * `rev` or history: they belong to one running Document.
 */
export function serializeDocument(doc: Document): string {
  const nodes = [...doc.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const file = {
    version: MIGRATIONS.length + 1,
    name: doc.name,
    artboards: sortKeys(doc.artboards),
    nodes: sortKeys(nodes),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const base = {
  ...Writable.shape,
  id: z.string().min(1),
  parentId: z.string().nullable(),
  index: z.string(),
  transform: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
};
const appearance = z.strictObject({
  fills: z.array(z.strictObject(Fill.shape)),
  strokes: z.array(z.strictObject(Stroke.shape)),
});
/** A Node exactly as stored; unknown keys are refused so nothing in a file is dropped silently. */
const StoredNode = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("layer") }),
  z.strictObject({ ...base, type: z.literal("group") }),
  z.strictObject({ ...base, ...TextShape.shape, appearance }),
  ...Object.values(SHAPES).map((s) =>
    z.strictObject({ ...base, ...s.shape, appearance, clipping: z.boolean().optional() }),
  ),
]);
const FileSchema = z.strictObject({
  version: z.number(),
  name: z.string().min(1),
  artboards: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string(),
        frame: z.strictObject({
          ...Rect.shape,
          width: z.number().positive(),
          height: z.number().positive(),
        }),
        background: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(1000),
  nodes: z.array(StoredNode),
});

const HINT = "A .zibel.json file is what zibel_export returns with format zibel_json.";
const invalid = (path: string, message: string, hint = HINT) =>
  new ZibelError({ code: "INVALID_DOCUMENT", message, hint, path });

/**
 * Reads `.zibel.json` text (ADR-0016): runs the `up` migrations of an older version, then checks
 * everything core checks on a write. Every failure names its `path` in the file.
 */
export function parseDocument(
  text: string,
  migrations = MIGRATIONS,
): { name: string; artboards: Artboard[]; nodes: Node[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw invalid("content", `Not JSON: ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("content", "A .zibel.json file is one JSON object.");
  }
  const current = migrations.length + 1;
  let file = raw as Record<string, unknown>;
  const { version } = file;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalid("version", `version is ${JSON.stringify(version)}, not a schema version.`);
  }
  if (version > current) {
    throw invalid(
      "version",
      `Version ${version} is newer than this Zibel, which reads up to ${current}.`,
      "The file was saved by a newer Zibel; open it there. Versions never downgrade.",
    );
  }
  for (let v = version; v < current; v++) {
    file = { ...(migrations[v - 1] as Migration)(file), version: v + 1 };
  }

  const parsed = FileSchema.safeParse(file);
  if (!parsed.success) {
    const issue = parsed.error.issues[0] as z.core.$ZodIssue;
    const keys = issue.code === "unrecognized_keys" ? issue.keys.slice(0, 1) : [];
    const path = zodPath([...issue.path, ...keys]).slice(1) || "content";
    throw invalid(path, `${path}: ${issue.message}`);
  }
  const artboards = parsed.data.artboards.map(
    ({ background, ...a }, i): Artboard => ({
      ...a,
      ...(background !== undefined && {
        background: parseColor(background, `artboards[${i}].background`),
      }),
    }),
  );
  const nodes = parsed.data.nodes.map((n, i): Node => {
    if (n.type === "layer" || n.type === "group") return n;
    const at = `nodes[${i}]`;
    const painted = {
      ...n,
      appearance: paint(n.appearance as AppearanceInput, `${at}.appearance`),
    };
    if (painted.type === "path") painted.d = formatPath(parsePath(painted.d, `${at}.d`));
    return painted as Node;
  });

  const unique = (ids: string[], at: (i: number) => string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id))
        throw invalid(at(i), `Duplicate id ${id}.`, "Every id in a file is unique.");
      seen.add(id);
    });
  };
  unique(
    artboards.map((a) => a.id),
    (i) => `artboards[${i}].id`,
  );
  unique(
    nodes.map((n) => n.id),
    (i) => `nodes[${i}].id`,
  );
  const doc: Document = {
    id: "",
    name: parsed.data.name,
    version: 1,
    rev: 0,
    artboards,
    nodes: new Map(nodes.map((n) => [n.id, n])),
  };
  const siblings = new Set<string>();
  const clipped = new Set<string | null>();
  nodes.forEach((n, i) => {
    const at = `nodes[${i}]`;
    // An Artboard id falls through to assertParent, whose hint explains Artboards are not parents.
    const { parentId } = n;
    if (
      parentId !== null &&
      !doc.nodes.has(parentId) &&
      !artboards.some((a) => a.id === parentId)
    ) {
      throw invalid(`${at}.parentId`, `No Node with id ${parentId} in the file.`);
    }
    assertParent(doc, n, n.parentId, `${at}.parentId`);
    try {
      // ponytail: fractional-indexing exports no validator; this also refuses the very top key.
      generateKeyBetween(n.index, null);
    } catch {
      throw invalid(`${at}.index`, `${JSON.stringify(n.index)} is not a fractional-index key.`);
    }
    const key = JSON.stringify([n.parentId, n.index]);
    if (siblings.has(key)) {
      throw invalid(
        `${at}.index`,
        `Another child of the same parent has index ${n.index}.`,
        "Siblings are ordered by index, so each needs its own.",
      );
    }
    siblings.add(key);
    if ("clipping" in n && n.clipping) {
      const hint = "A Clipping Path is the one clipping child of a Group, and visible (ADR-0021).";
      if (doc.nodes.get(n.parentId ?? "")?.type !== "group") {
        throw invalid(`${at}.clipping`, "A Clipping Path's parent is a Group.", hint);
      }
      if (clipped.has(n.parentId)) {
        throw invalid(`${at}.clipping`, "Its Group already has a Clipping Path.", hint);
      }
      if (!n.visible) throw invalid(`${at}.visible`, "A Clipping Path cannot be hidden.", hint);
      clipped.add(n.parentId);
    }
  });
  if (!nodes.some((n) => n.type === "layer" && n.parentId === null)) {
    throw invalid(
      "nodes",
      "No top-level Layer.",
      "Every Document has at least one Layer at its root.",
    );
  }
  return { name: parsed.data.name, artboards, nodes };
}
