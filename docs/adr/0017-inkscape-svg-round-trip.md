---
status: accepted
date: 2026-09-24
---

# SVG is the editing round trip, and Inkscape is the editor it targets

Import and export are core features: a designer takes what an Agent drew, finishes it in a desktop editor and brings it back (#24). The editor is **Inkscape**. Its native format is SVG with the `inkscape:` and `sodipodi:` namespaces, so Zibel can write a file Inkscape treats as its own, and its CLI lets us test the round trip. Native `.ai` stays a non-goal (§1.4); an `.ai` saved PDF-compatible reaches Zibel by opening it in Inkscape and saving SVG.

## What "complete" means

Zibel's model is the source of truth. Everything a Document can hold survives **Zibel → Inkscape → edit → Zibel** structurally: Layers with names, visibility and lock; Artboards; Live Shape parameters; text and font names; Appearance; opacity and blend mode; `tags` and `meta`.

When a designer uses something in Inkscape that Zibel cannot represent, that is a gap in Zibel, and Zibel gains it. This covers model features (gradients, compound paths with fill rule, clipping masks, images, multi-line text) and Inkscape's shape parameters: a star's or polygon's `rounded`, `randomized` and twist (`arg2 − arg1 ≠ π / points`), an ellipse's start and end angles with slice, chord and open arc types, and Inkscape's spiral parameters when the spiral Live Shape arrives. #24 closes only when those exist. Until one lands, its content imports as a Path or solid Fill with a warning.

What Zibel will not model imports as its visible geometry with one warning per kind: Live Path Effects (their output `d`, not `inkscape:original-d`), `flowRoot`, 3D boxes, and SVG filters until Effects exist (F-APP-10). F-IO-01's "keep unsupported elements as raw XML fragments" is dropped: an opaque node type would be unreadable by Agents and undrawable by Canvas2D, and every feature it would carry is on the roadmap.

Every new node type or Appearance feature ships with its SVG export mapping, its import mapping and a round-trip fixture, in the same issue.

## One serializer, written in Inkscape's dialect

`toSvg` has one output, used by `render` and by `export`. The editable form renders to the same pixels as today's, and browsers and resvg ignore the editor namespaces, so there is no plain flavour and no mode. A plain export can become an F-IO-06 option when someone needs one.

| Zibel | SVG |
|---|---|
| Document | root `width`/`height` in `pt` and `viewBox` of the first Artboard, so one user unit is one pt; `inkscape:document-units="pt"`; `zibel:doc` (docId) and `zibel:rev` (the exported rev) |
| Artboard | `<inkscape:page x y width height id inkscape:label>` in `<sodipodi:namedview>`, user units. Inkscape has no per-page background, so a background is a locked `<rect zibel:artboard="<id>">` that import turns back into the Artboard's `background` |
| Layer | `<g inkscape:groupmode="layer" inkscape:label>` |
| Any Node | `id="z-<ULID>"` (an XML id cannot start with a digit); name → `inkscape:label`; hidden → `style="display:none"`, written, not dropped; locked → `sodipodi:insensitive="true"`; `opacity` and `mix-blend-mode` in `style`; `tags`, `meta` (JSON) → `zibel:tags`, `zibel:meta` |
| Leaf with ≤ 1 Fill and ≤ 1 Stroke | one element with both `fill` and `stroke` |
| Appearance stack | a `<g zibel:stack>` of paints, read back as one Node |
| `rect`, `ellipse`, `line` | `<rect rx ry>`, `<circle>` or `<ellipse>`, `<line>` |
| `polygon`, `star` | `<path sodipodi:type="star">` with `sodipodi:sides/cx/cy/r1/r2/arg1/arg2`, `inkscape:flatsided/rounded/randomized` and a `d` that matches them, because Inkscape rebuilds the shape from the parameters on load. `arg1 = −π/2` (first vertex up, radians, clockwise); rotation stays in `transform` |
| `text` | `<text>` with the Node's `fontFamily` |

Inkscape keeps unknown-namespace attributes, `data-*` and existing ids on save (verified in its source, #24), which is what makes the `zibel:` attributes and the id mapping hold.

## Import

- **Parser:** `@xmldom/xmldom` (MIT, no dependencies, `getAttributeNS`). It does not expand DTD entities and never fetches, so entity bombs and external entities cannot happen. Sanitising strips `<script>`, event attributes and `foreignObject` and caps data URLs (§7.x). saxes, sax and linkedom fail the licence list (§8.4); HTMLRewriter builds no tree.
- **Paths** normalise to absolute `M L C Q Z` in `core/path.ts`, next to `parsePath`: relative commands and `H V S T` fold, `A` becomes cubics. `node_create` still accepts only canonical `d`.
- **Transforms.** Inkscape keeps `transform` on a moved `<g>`. A Layer or Group never carries a matrix (ADR-0007), so ancestor transforms compose into each leaf. Inkscape's default "optimized" transforms also bake a move into `x`/`d`; import takes those values as they are.
- **Styles:** presentation attributes, `style`, `<style>` classes and inheritance resolve to Appearance; any CSS colour converts to `#RRGGBB[AA]`, folding `fill-opacity` and `stroke-opacity` into alpha. Units convert to pt from the root `width`/`height` and `viewBox` (Inkscape defaults to mm).
- **Structure:** `inkscape:groupmode="layer"` → Layer, other `<g>` → Group; `<inkscape:page>`, else the root `viewBox`, → Artboards; `sodipodi:insensitive` with any value → locked.
- **Stars:** `arg1 ≠ −π/2` folds into `transform` as a rotation about the centre. `rounded`, `randomized` and twist map to the star parameters once they exist (above). `sodipodi:type="arc"` maps to the ellipse's angles and arc type likewise.
- **Ids:** `z-<ULID>` maps back to that Node. Any other id (Inkscape gives new and duplicated objects ids like `path123`) is a new Node with a new ULID. A `<g zibel:stack>` the designer ungrouped comes back as separate Nodes.
- **Text:** `<text>` with `<tspan sodipodi:role="line">` → Text. The font name is kept whatever it is (below).

## Three ways in

| | Illustrator | Tool | Result |
|---|---|---|---|
| **Open** | File > Open | `doc_open(content)`, SVG or `.zibel.json` detected by content | a new Document; SVG Layers and pages become Layers and Artboards; ids from `z-` kept |
| **Replace** | — | `doc_replace(docId, content, baseRev?, ifRev?, intent?)`, SVG or `.zibel.json` | the same Document updated by a three-way merge, one undoable Transaction of the calling Actor |
| **Place** | File > Place, paste | `svg_import(docId, svg, parentId, position?, fit?)` | one Group under `parentId`; SVG Layers become Groups, pages are ignored, all ids are new |

**Replace** is the round trip's main path, because a designer may work for an hour while Agents keep writing:

1. **Base.** `baseRev`, else the SVG's `zibel:rev` when its `zibel:doc` is this Document. The Document at that rev is rebuilt by walking the Transaction log back with its stored inverse deltas (ADR-0011).
2. **Normalise the base** through export and import, and compare the file with that, not with the raw base. Export rounds numbers to 3 decimals and rewrites colours; without this every Node would look edited.
3. **Apply only what the file changed** onto the current Document. A property both sides changed takes the file's value; a Node deleted in the Document since the base stays deleted and is reported (ADR-0004: per-property last writer wins, delete beats edit). Artboards merge the same way.
4. **Fallback.** No base (a foreign SVG, a `.zibel.json`, which carries no rev per ADR-0016, and no `baseRev`), or a log that no longer reaches it: compare the file with the current Document, and warn that concurrent edits may be overwritten.

Browser: the toolbar gets "Download SVG" beside the `.zibel.json` download and "Update from file…" (Replace); the Document list gets "Open file" (`.svg`, `.zibel.json`); dropping an SVG on the canvas or pasting SVG text is Place, at the viewport centre. Replace is only ever an explicit button.

## Fonts

`fontFamily` becomes any string, kept as written. A family Zibel does not have renders in the bundled font (ADR-0013) with a warning, and export writes the original name back, so the file shows the right font in Inkscape (F-TEXT-11, the "record the original name" part). Font upload and embedding are separate work.

## Testing

`pnpm roundtrip` (#27): export each fixture Document, re-save it with `inkscape --export-type=svg` (Inkscape SVG), import, and check that outline, Node types, parameters, names, visibility, lock and Artboards equal the original's; also that resvg's PNG and Inkscape's PNG of the export differ by under 1% of pixels. It needs Inkscape ≥ 1.2 (Ubuntu 24.04 ships 1.2.2) and Node, so it runs outside `pnpm check`: locally, skipping when `inkscape` is missing, and as its own CI job.

Inkscape is GPL. It is only an external program here: no Inkscape source is copied or ported. Its shape formulas (star rounding, randomisation) are implemented from its documentation and observed output, and the round-trip check is what proves they match.

## Considered Options

- **Illustrator as the editor.** Its native format is private (AIPrivateData inside a PDF container, no public spec), so the round trip would go through SVG or PDF and lose Layers on the way, and nothing could test it in CI.
- **Two SVG flavours, or a render mode on `toSvg`.** Unneeded, because the editable form renders identically.
- **Raw XML fragments for unsupported content.** Rejected above.
- **Downgrade what Zibel lacks** (gradient → solid, drop rounding). Loses the designer's work; the user ruled that such losses are Zibel's gaps to close.
- **Open only, or Replace by overwriting.** Open gives a new docId, so Agents lose the Document they were working on; overwriting drops what Agents wrote meanwhile.
- **fast-xml-parser, txml, htmlparser2.** fast-xml-parser does not decode numeric character references by default and needs order-preserving options; txml decodes nothing and trims whitespace; htmlparser2 brings four dependencies. xmldom gives a standard DOM with namespaces and safe entity handling.

## Consequences

- MCP surface: `doc_open` accepts SVG; `doc_replace` and `svg_import` are new. `svg_import` is capped at 5 MB (§6.7).
- ADR-0013's one-font rule now holds for rendering only; the schema keeps any `fontFamily`.
- New dependency `@xmldom/xmldom` in a new `packages/io`.
- After an Inkscape save, elements Zibel wrote without an id carry Inkscape's auto ids; import ignores them unless they are the only id on a new object.
- A moved object may come back with new `x`/`d` and identity `transform`; `doc_changes` shows both properties changed, which is what happened.
- F-IO-01, F-IO-03, F-IO-04, F-IO-05, F-IO-06, F-DRAW-01, F-DRAW-03, F-TEXT-11, §6.4, §7.2, §9 and Appendix A change to match (REQUIREMENTS decision 38).
