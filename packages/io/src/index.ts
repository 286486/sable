import { fontWarnings, parseDocument, ZibelError } from "@zibel/core";
import { type OpenedFile, parseSvg, type Warning } from "./svg.ts";

export type { OpenedFile, Warning };

/** The largest SVG Open reads, in UTF-16 code units (REQUIREMENTS §6.7). */
export const SVG_LIMIT = 5 * 1024 * 1024;

/**
 * Reads a file for Open (ADR-0017): `.zibel.json` or SVG, told apart by content. `name` is the
 * file name, used for an SVG that names no Document.
 */
export function parseFile(content: string, { name }: { name?: string } = {}): OpenedFile {
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
  return { ...file, warnings: [...file.warnings, ...fonts.values()] };
}
