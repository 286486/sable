import {
  type Document,
  fontWarnings,
  parseDocument,
  type RenderScope,
  ZibelError,
} from "@zibel/core";
import { type OpenedFile, type Origin, parseSvg, type Warning } from "./read.ts";
import { toSvg } from "./write.ts";

export { MAX_DEPTH, parseSvg } from "./read.ts";
export { docRect, type SvgOptions, scopeRect, svgRect, toSvg } from "./write.ts";

export type { OpenedFile, Origin, Warning };

/** The largest SVG Open reads, in UTF-16 code units (REQUIREMENTS §6.7). */
export const SVG_LIMIT = 5 * 1024 * 1024;

/**
 * Reads a file for Open (ADR-0017): `.zibel.json` or SVG, told apart by content. `name` is the
 * file name, used for an SVG that names no Document.
 */
export function parseFile(
  content: string,
  { name }: { name?: string } = {},
): OpenedFile & { format: "svg" | "zibel_json" } {
  const text = content.replace(/^﻿/, "").trimStart();
  let file: OpenedFile;
  if (text.startsWith("{")) file = { ...parseDocument(text), warnings: [] };
  else if (text.startsWith("<")) {
    if (text.length > SVG_LIMIT) {
      throw new ZibelError({
        code: "LIMIT_EXCEEDED",
        message: `The SVG is ${text.length} characters; Open reads at most ${SVG_LIMIT}.`,
        hint: "Split the drawing into several files, or remove embedded images and unused defs.",
        path: "content",
      });
    }
    file = parseSvg(text, name);
  } else {
    throw new ZibelError({
      code: "INVALID_DOCUMENT",
      message: "The content is not an SVG or .zibel.json file.",
      hint: "Pass the text of an .svg file, or of a .zibel.json file as zibel_export returns it.",
      path: "content",
    });
  }
  // One per font, not per text: a file set in one missing font says so once.
  const fonts = new Map<string, Warning>();
  for (const w of fontWarnings(file.nodes)) if (!fonts.has(w.message)) fonts.set(w.message, w);
  const format = text.startsWith("<") ? "svg" : "zibel_json";
  return { ...file, format, warnings: [...file.warnings, ...fonts.values()] };
}

/**
 * `doc` passed through the export and import a file of `scope` took, so that rounding and the
 * importer's baking count the same on both sides of Replace's diff (ADR-0017). A nodeIds scope
 * keeps the ids `doc` still has.
 */
export function normalise(doc: Document, scope: RenderScope | undefined): Document {
  let s = scope;
  if (s && "nodeIds" in s) {
    const nodeIds = s.nodeIds.filter((id) => doc.nodes.has(id));
    if (nodeIds.length === 0) return { ...doc, nodes: new Map() };
    s = { nodeIds };
  }
  const { artboards, nodes } = parseSvg(toSvg(doc, undefined, { scope: s }));
  return { ...doc, artboards, nodes: new Map(nodes.map((n) => [n.id, n])) };
}
