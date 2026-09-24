import type { Document } from "./schema.ts";

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
    version: doc.version,
    name: doc.name,
    artboards: sortKeys(doc.artboards),
    nodes: sortKeys(nodes),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}
