import {
  type Artboard,
  applyRows,
  type Document,
  type ImageSource,
  type Node,
  type RenderScope,
  same,
  type TxRow,
  ZibelError,
} from "@zibel/core";
import { generateNKeysBetween } from "fractional-indexing";
import { type OpenedFile, parseSvg, type Warning } from "./read.ts";
import { toSvg } from "./write.ts";

/**
 * Replace (ADR-0017): merges `file`, exported from `doc` and edited since, back into `doc` in place.
 * The base is the Document at `opts.baseRev`, else the SVG's `zibel:rev`, which `rebuild` returns
 * from the Delta Log, or null once it no longer reaches it; without a base the file is compared
 * with `doc` as it is, with a NO_BASE warning. Throws INVALID_DOCUMENT for a file from another
 * Document and REV_CONFLICT for a base rev `doc` has not reached, before changing anything.
 * `opts.images` gives the Document's image files, which the normalising export writes. The file's
 * own images are the caller's to store.
 */
export function replaceFile(
  doc: Document,
  file: OpenedFile & { format: "svg" | "zibel_json" },
  opts: { baseRev?: number; rebuild: (rev: number) => Document | null; images?: ImageSource },
): {
  created: Node[];
  updated: Node[];
  deletedIds: string[];
  artboards?: Artboard[];
  skipped: string[];
  warnings: Warning[];
} {
  const svg = file.format === "svg";
  if (svg ? file.origin?.docId !== doc.id : !file.nodes.some((n) => doc.nodes.has(n.id))) {
    throw new ZibelError({
      code: "INVALID_DOCUMENT",
      message: svg
        ? `This SVG was not exported from Document ${doc.id}: its zibel:doc is ${file.origin?.docId ?? "missing"}.`
        : `This .zibel.json has no Node of Document ${doc.id}.`,
      hint: "Replace takes a file exported from this Document. Open any other file as a new Document with zibel_doc_open.",
      path: "content",
    });
  }
  const baseRev = opts.baseRev ?? file.origin?.rev;
  if (baseRev !== undefined && baseRev > doc.rev) {
    throw new ZibelError({
      code: "REV_CONFLICT",
      message: `The Document is at rev ${doc.rev}, before the file's base rev ${baseRev}.`,
      hint: "Pass the rev the file was exported at, or leave baseRev out for an SVG.",
      path: "baseRev",
      rev: doc.rev,
    });
  }
  const { scope } = file.origin ?? {};
  const norm = (d: Document) =>
    svg ? normalise(d, scope, opts.images) : { ...d, nodes: new Map(d.nodes) };
  const current = norm(doc);
  const base = baseRev === undefined ? null : opts.rebuild(baseRev);
  const warnings = [...file.warnings];
  if (!base) {
    warnings.push({
      code: "NO_BASE",
      message:
        "No base to merge from, so the file was compared with the Document as it is now: edits made since the export in its scope may be overwritten.",
    });
  }
  const change = merge(doc, { base: base ? norm(base) : current, current }, file, scope);
  for (const nodeId of change.skipped) {
    warnings.push({
      code: "DELETED_SINCE",
      nodeId,
      message: `${nodeId}, or the parent the file puts it in, was deleted after the export; the file's edits to it were not applied.`,
    });
  }
  return { ...change, warnings };
}

/**
 * `doc` passed through the export and import a file of `scope` took, so that rounding and the
 * importer's baking count the same on both sides of Replace's diff (ADR-0017). A nodeIds scope
 * keeps the ids `doc` still has. `images` gives its image files.
 */
export function normalise(
  doc: Document,
  scope: RenderScope | undefined,
  images?: ImageSource,
): Document {
  let s = scope;
  if (s && "nodeIds" in s) {
    const nodeIds = s.nodeIds.filter((id) => doc.nodes.has(id));
    if (nodeIds.length === 0) return { ...doc, nodes: new Map() };
    s = { nodeIds };
  }
  // Each data URL written maps back to its id, so the read needs no hashing (ADR-0023).
  // ponytail: every image's bytes go through base64 and the parser twice per Replace; compare ids
  // without writing bytes if large Documents make Replace slow.
  const ids = new Map<string, string>();
  const write = (id: string) => {
    const url = images?.(id);
    if (url !== undefined) ids.set(url, id);
    return url;
  };
  const svg = toSvg(doc, undefined, { scope: s, images: write });
  const { artboards, nodes } = parseSvg(svg, undefined, { known: (url) => ids.get(url) });
  return { ...doc, artboards, nodes: new Map(nodes.map((n) => [n.id, n])) };
}

/**
 * Replace's three-way merge (ADR-0017): applies onto `doc` only what `file` changed relative to the
 * base it was exported from. `norm.base` and `norm.current` are the base and `doc` passed through
 * the same export and import as the file (for `.zibel.json`, as stored), so rounding and Inkscape's
 * rewriting do not count as edits.
 *
 * Per top-level key the file wins where it changed one, and the Document's value stays everywhere
 * else (ADR-0004); `appearance` is one key, so a recolour replaces an Agent's concurrent Stroke edit
 * on the same Node. A changed Node lands in its normalised form, which may move a baked translation
 * from `transform` into `x` or `d`.
 * ponytail: `x` and `transform` are separate keys, so a file move of a Node an Agent turned after the
 * export lands inside the Agent's matrix; merge geometry as one key if that shows up.
 *
 * Nodes missing from the file are deleted only when the base export contained them: at nodeIds
 * scope, the listed Nodes and what they contain, not the containers written as the way to them.
 * ponytail: an element the importer drops (INVALID_PATH, INVALID_TRANSFORM) is missing too, so
 * its Node is deleted; have the importer report dropped ids if Inkscape ever writes such files.
 * Artboards are compared with `norm.current` until Artboard edits are logged (F-VIEW-06), and only
 * those whose id the Document has are updated.
 */
function merge(
  doc: Document,
  norm: { base: Document; current: Document },
  file: { artboards: Artboard[]; nodes: Node[] },
  scope?: RenderScope,
): {
  created: Node[];
  updated: Node[];
  deletedIds: string[];
  skipped: string[];
  artboards?: Artboard[];
} {
  const inFile = new Map(file.nodes.map((n) => [n.id, n]));
  const working = new Map<string, Node>();
  const rows: TxRow[] = [];

  for (const f of file.nodes) {
    const now = doc.nodes.get(f.id);
    const base = norm.base.nodes.get(f.id) ?? (now && norm.current.nodes.get(f.id));
    if (!base) {
      working.set(f.id, f);
      continue;
    }
    const changed = keysChanged(base, f);
    if (changed.length === 0) continue;
    // Deleted since: applyRows skips and reports it.
    if (!now) rows.push({ id: f.id, base, working: f });
    else
      working.set(
        f.id,
        patch({ ...(norm.current.nodes.get(f.id) ?? now), index: now.index }, f, changed),
      );
  }

  const listed = scope && "nodeIds" in scope ? new Set(scope.nodeIds) : undefined;
  const contained = (n: Node | undefined): boolean =>
    !listed || (!!n && (listed.has(n.id) || contained(norm.base.nodes.get(n.parentId ?? ""))));
  for (const b of norm.base.nodes.values()) {
    const now = doc.nodes.get(b.id);
    if (now && !inFile.has(b.id) && contained(b)) rows.push({ id: b.id, base: now, working: null });
  }

  const deleting = new Set(rows.filter((r) => !r.working).map((r) => r.id));
  for (const parentId of new Set(file.nodes.map((n) => n.parentId))) {
    reorder(doc, norm.base, inFile, working, deleting, parentId);
  }

  for (const [id, w] of working) rows.push({ id, base: doc.nodes.get(id) ?? null, working: w });

  const artboards = doc.artboards.map((a) => {
    const f = file.artboards.find((x) => x.id === a.id);
    const was = norm.current.artboards.find((x) => x.id === a.id);
    return f && was && !same(f, was) ? f : a;
  });
  const boardsChanged = artboards.some((a, i) => a !== doc.artboards[i]);
  return { ...applyRows(doc, rows), ...(boardsChanged && { artboards }) };
}

/** Top-level keys whose value differs, but `index`: each side's importer numbers siblings anew. */
function keysChanged(base: Node, file: Node): string[] {
  const b = base as unknown as Record<string, unknown>;
  const f = file as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(f)])].filter(
    (k) => k !== "index" && !same(b[k], f[k]),
  );
}

/** `node` with `keys` taken from `from`, removing those `from` lacks. */
function patch(node: Node, from: Node, keys: string[]): Node {
  const out: Record<string, unknown> = { ...node };
  const src = from as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (Object.hasOwn(src, k)) out[k] = src[k];
    else delete out[k];
  }
  return out as unknown as Node;
}

/**
 * Gives `parentId`'s children the file's stacking order when it differs from the base's, or when
 * the file added children to it. Siblings the file does not hold (created since, or out of scope)
 * stay right above the sibling they follow now. Keys already in order are kept, so moving one Node
 * changes one index.
 * ponytail: nothing but Replace reorders or reparents yet, so there is no concurrent order to merge
 * with; merge orders when node_reorder lands.
 */
function reorder(
  doc: Document,
  base: Document,
  inFile: Map<string, Node>,
  working: Map<string, Node>,
  deleting: Set<string>,
  parentId: string | null,
) {
  const kids = (nodes: Iterable<Node>) =>
    [...nodes]
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => (a.index < b.index ? -1 : 1))
      .map((n) => n.id);
  const order = kids(inFile.values());
  const was = kids(base.nodes.values()).filter((id) => inFile.get(id)?.parentId === parentId);
  if (same(order, was)) return;

  const held = new Set(order);
  const follows = new Map<string | null, string[]>();
  let prev: string | null = null;
  for (const id of kids(doc.nodes.values())) {
    if (held.has(id)) prev = id;
    else if (!deleting.has(id) && (working.get(id)?.parentId ?? parentId) === parentId) {
      follows.set(prev, [...(follows.get(prev) ?? []), id]);
    }
  }
  const all = [
    ...(follows.get(null) ?? []),
    ...order.flatMap((id) => [id, ...(follows.get(id) ?? [])]),
  ];

  const keys: (string | undefined)[] = [];
  let last: string | undefined;
  for (const id of all) {
    const now = doc.nodes.get(id);
    const key = now?.parentId === parentId ? now.index : undefined;
    const keep = key !== undefined && (last === undefined || key > last);
    if (keep) last = key;
    keys.push(keep ? key : undefined);
  }
  for (let i = 0; i < all.length; ) {
    if (keys[i] !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < all.length && keys[j] === undefined) j++;
    generateNKeysBetween(keys[i - 1] ?? null, keys[j] ?? null, j - i).forEach((k, n) => {
      keys[i + n] = k;
    });
    i = j;
  }

  all.forEach((id, i) => {
    const index = keys[i] as string;
    const node = working.get(id) ?? doc.nodes.get(id);
    if (node && node.index !== index) working.set(id, { ...node, index });
  });
}
