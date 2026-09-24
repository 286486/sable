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
| Document | root `viewBox` is the export's first page and `width`/`height` are the same numbers in `pt`, so one user unit is one pt: at doc scope the frame of the Artboard at (0,0), else of the first Artboard, at artboard scope that Artboard's, at nodes or rect scope the scope's rect (below). `xmlns:zibel="https://zibel.dev/ns/svg"`; `zibel:doc` (docId), `zibel:rev` (the exported rev) and `zibel:scope` (`doc`, `artboard:<id>`, `nodes:<id,…>` or `rect:<x,y,w,h>`) |
| Artboard | `<inkscape:page x y width height id="z-<id>" inkscape:label>` in `<sodipodi:namedview inkscape:document-units="pt">`, user units. A doc-scope file lists every Artboard, an artboard-scope file only its own, a nodes- or rect-scope file none, so its viewport is its only page. Inkscape has no per-page background, so a background is a locked `<rect zibel:artboard="<id>">` that import turns back into the Artboard's `background` |
| Layer | `<g inkscape:groupmode="layer" inkscape:label>` |
| Any Node | `id="z-<ULID>"` (an XML id cannot start with a digit); name → `inkscape:label`; hidden → `style="display:none"`, written, not dropped; locked → `sodipodi:insensitive="true"`; `opacity` and `mix-blend-mode` in `style`; `tags` and `meta` as JSON → `zibel:tags`, `zibel:meta`, each left out when empty |
| Leaf with ≤ 1 Fill and ≤ 1 Stroke | one element with both `fill` and `stroke`; no Fill is `fill="none"`, so an empty Appearance is still an element |
| Appearance stack | a `<g zibel:stack="true">` of paints, read back as one Node; the paints carry no id |
| Colour with alpha | `fill="#RRGGBB" fill-opacity`, `stroke="#RRGGBB" stroke-opacity`, likewise Artboard and render backgrounds, opacity at 3 decimals, which recovers every alpha byte: Inkscape 1.2 draws `#RRGGBBAA` as black. Import reads both forms |
| `rect`, `ellipse`, `line` | `<rect rx ry>` (the clamped radius, left out at 0), `<circle>` when width equals height, else `<ellipse>`, `<line>` |
| `polygon`, `star` | `<path sodipodi:type="star">` with `sodipodi:sides/cx/cy/r1/r2/arg1/arg2`, `inkscape:flatsided/rounded/randomized` and a `d` that matches them, because Inkscape rebuilds the shape from the parameters on load. `arg1 = −π/2` (first vertex up, radians, clockwise) and `arg2 = arg1 + π/sides`, at full precision; a polygon is `flatsided="true"` with `r2` its inradius; `rounded` and `randomized` are written as 0; rotation stays in `transform` |
| `text` | `<text>` with the Node's `fontFamily` |

**Why the `viewBox` is the first page** (checked headless on Inkscape 1.2.2, #25). Page `x`/`y` are absolute user units, like element coordinates. But Inkscape binds the page at literal (0,0) to the root viewport and rewrites its width and height to the `viewBox`'s on save, whatever the `viewBox` origin; with no page at (0,0) it rewrites none. With `viewBox = docRect` and Artboard 1 at (0,0), the default layout, every Document with two Artboards would lose Artboard 1's size on the first save. So at doc scope the `viewBox` is the Artboard at (0,0), whose page Inkscape resizes to itself, or, when no Artboard sits there, the first Artboard, and no page is rewritten; the pages come back as written. This is Inkscape's own multi-page layout. A doc-scope SVG therefore shows only that Artboard in a browser; `render` and PNG `export` still cover every Artboard (ADR-0014), since they pass their own rect. Inkscape writes the viewport page's height as `200.00002` for 200 pt, px-to-pt roundoff that Replace's 3-decimal rounding absorbs. With a non-zero `viewBox` origin, 1.2.2's multi-page PDF export assigns items to pages in another space than it draws them in; the SVG it saves is unaffected.

resvg reads the root's `pt` at 72 dpi, so it still draws one pixel per point at scale 1. Native `<rect rx>`, `<circle>` and `<ellipse>` draw the exact outline, where the `<path>` written before rounded its control points to 3 decimals, so the change moved a few antialiased edge pixels once (3 pixels by at most 16/255 on the fixture Document at 1x).

Inkscape keeps unknown-namespace attributes, `data-*` and existing ids on save, which is what makes the `zibel:` attributes and the id mapping hold. Its XML tree is its model (`src/xml/repr-io.cpp`), unknown elements are kept as XML (`src/object/sp-factory.cpp`), ids are kept unless they clash (`src/object/sp-object.cpp`), and the default preference `incorrect_attributes_remove` is 0 (`src/preferences-skeleton.h`), per Inkscape 1.4.x.

## Import

- **Parser:** `@xmldom/xmldom` (MIT, no dependencies, `getAttributeNS`). It does not expand DTD entities and never fetches, so entity bombs and external entities cannot happen. Sanitising strips `<script>`, event attributes and `foreignObject` and caps data URLs (§7.5). A file that is not well-formed XML or has no `<svg>` root is `INVALID_DOCUMENT`, with `path` locating the element, as for `.zibel.json` (ADR-0016). saxes, sax and linkedom fail the licence list (§8.4); HTMLRewriter builds no tree.
- **Paths** normalise to absolute `M L C Q Z` in `core/path.ts`, next to `parsePath`: relative commands and `H V S T` fold, `A` becomes cubics. `node_create` still accepts only canonical `d`.
- **Transforms.** Inkscape keeps `transform` on a moved `<g>`. A Layer or Group never carries a matrix (ADR-0007), so ancestor transforms compose into each leaf. Inkscape's default "optimized" transforms also bake a move into `x`/`d`; import takes those values as they are.
- **Styles:** presentation attributes, `style`, `<style>` classes and inheritance resolve to Appearance; any CSS colour converts to `#RRGGBB[AA]`, folding `fill-opacity` and `stroke-opacity` into alpha. Units convert to pt from the root `width`/`height` and `viewBox` (Inkscape defaults to mm).
- **Structure:** `inkscape:groupmode="layer"` → Layer, other `<g>` → Group; `<inkscape:page>`, else the root `viewBox`, → Artboards; `sodipodi:insensitive` with any value → locked.
- **Stars:** `arg1 ≠ −π/2` folds into `transform` as a rotation about the centre. `rounded`, `randomized` and twist map to the star parameters once they exist (above). `sodipodi:type="arc"` maps to the ellipse's angles and arc type likewise.
- **Ids:** `z-<ULID>` maps back to that Node. Any other id (Inkscape gives new and duplicated objects ids like `path123`) is a new Node with a new ULID. A `<g zibel:stack>` the designer ungrouped comes back as separate Nodes.
- **Text:** `<text>` with `<tspan sodipodi:role="line">` → Text. The font name is kept whatever it is (below).

The importer (`packages/io`, #26) settles the rest:

- **Size.** An SVG over 5 MB, counted as 5 × 1024 × 1024 UTF-16 code units (`content.length`), is `LIMIT_EXCEEDED` before parsing; Replace and Place measure the same way. `.zibel.json` stays uncapped (ADR-0016). Layers and Groups nested deeper than 256 levels are `LIMIT_EXCEEDED` too: the walk and core's own walks recurse.
- **Units.** px and unitless lengths are one pt, as Illustrator opens SVG; Inkscape's 96 dpi (0.75 pt per px) is not followed. User units scale by root `width` ÷ `viewBox` width; the `viewBox` origin is not subtracted, so a Zibel export's coordinates come back unchanged. Lengths with units inside the file (`stroke-width="1mm"`) convert by the same table.
- **Baking.** A leaf's composed matrix (ancestors, root scale, its own) that is a move plus a uniform scale bakes into its parameters, Stroke widths and dashes, leaving `transform` identity; any other matrix is stored at 6 decimals with the parameters in the leaf's own units. Numbers round to 3 decimals, which also absorbs Inkscape's `200.00002`. Export writes matrices at the 6 decimals they are stored in, so a turned Node opens with its own matrix.
- **SVG defaults, not Zibel's.** An unstated `fill` is black and `stroke` none; an unstated `stroke-miterlimit` is SVG's 4 for a miter join, where it shows, and Zibel's 10 for other joins. The cascade is inherited value, presentation attribute, `<style>` rule (simple selectors only), `style` attribute.
- **Structure.** Content at the root outside any layer goes into one Layer named `Layer 1`, made where the first such element appears; a file with no content still gets it. A layer group inside a Group is a Group. Sibling indexes are `a0, a1, …` in document order, as `node_create` gives them.
- **Markers.** A `<rect zibel:artboard>` sets that Artboard's background only when the page is in the file, and is never a Node. Export marks the `background` option's rect `zibel:background="true"`, and import drops it.
- **Name.** The file name (browser Open), else `sodipodi:docname` without `.svg`, which export now writes, else the root `<title>`, else `Untitled`.
- **Stacks.** A `<g zibel:stack>` is one Node: its id, name, lock, tags, meta, opacity and blend from the `<g>`, its geometry from the first paint, then every Fill, then every Stroke, in order.
- **Text.** Each line tspan is its own Point Type Node; the first keeps the `<text>` id. Whitespace collapses unless `xml:space="preserve"`. The first family of `font-family` is kept, unquoted; `text-anchor` middle or end moves `x` by the measured width.
- **Warnings** are `{code, nodeId?, message}`, once per kind: `UNSUPPORTED_ELEMENT` (per tag), `UNSUPPORTED_ATTRIBUTE` (per property: `clip-path`, `mask`, `filter`, markers, `fill-rule: evenodd`), `PATH_EFFECT_FLATTENED`, `BOX3D_AS_PATHS`, `GRADIENT_FLATTENED`, `UNSUPPORTED_PAINT`, `STAR_AS_PATH`, `ARC_AS_PATH`, `DUPLICATE_ID`, `INVALID_TAGS_META`, `INVALID_PATH` (the element is dropped), `INVALID_TRANSFORM` (an unreadable transform is ignored, one that scales to nothing drops the element) and `FONT_MISSING` (per font). `clip-path`, `mask` and `filter` warn on a Layer or Group as on a leaf.
- **Checked like a file.** The importer's result goes through the `.zibel.json` validator before the Durable Object sees it, so an importer bug fails the Open instead of storing a corrupt Document.

## Three ways in

| | Illustrator | Tool | Result |
|---|---|---|---|
| **Open** | File > Open | `doc_open(content)`, SVG or `.zibel.json` detected by content | a new Document; SVG Layers and pages become Layers and Artboards; ids from `z-` kept |
| **Replace** | — | `doc_replace(docId, content, baseRev?, ifRev?, intent?)`, SVG or `.zibel.json` | the same Document updated by a three-way merge, one undoable Transaction of the calling Actor |
| **Place** | File > Place, paste | `svg_import(docId, svg, parentId, position?, fit?)` | one Group under `parentId`; SVG Layers become Groups, pages are ignored, all ids are new |

**Replace** is the round trip's main path, because a designer may work for an hour while Agents keep writing. It accepts a file only when it came from this Document: an SVG whose `zibel:doc` is this docId, or a `.zibel.json` (which carries no docId, ADR-0016; its ids must overlap the Document's). Any other file is refused as `INVALID_DOCUMENT` with a hint to Open or Place it, because replacing with it would delete every Node in scope.

1. **Base.** `baseRev`, else the SVG's `zibel:rev`. The Document at that rev is rebuilt by applying, newest first, the inverse delta of every Transaction committed since. That needs a delta for **every** rev, not only for those on the undo and redo stacks, which today lose their deltas on undo and on redo-clear (ADR-0011). So every committed Transaction's delta is kept in a rev-indexed log independent of the stacks, pruned only when older than 30 days; the stacks keep their 200-entry limit and point into it. This supersedes ADR-0011's "older ones drop off with their delta rows".
2. **Normalise the base** by exporting it with the file's `zibel:scope` and importing that, and compare the file with the result, not with the raw base. Both sides are then rounded to export precision (3 decimals; `d` compared as parsed, rounded segments) before the per-property diff: export rounds, Inkscape rewrites `d` in relative form at its own precision, and re-absolutising reintroduces float error, so without this every Path would look edited.
3. **Apply only what the file changed** onto the current Document. Deletions are confined to the Nodes the scoped export of the base contained, so a file exported from one Artboard can never delete Nodes elsewhere. A property both sides changed takes the file's value; a Node deleted in the Document since the base stays deleted and is reported (ADR-0004: per-property last writer wins, delete beats edit). Artboards merge the same way once Artboard edits exist and are logged (F-VIEW-06); until then they are compared with the current Document.
4. **Fallback.** No base (a `.zibel.json` without `baseRev`, or a log pruned past the base): compare the file with the current Document exported at the same scope, and warn that concurrent edits in that scope may be overwritten.

Browser: Open, Replace and Place send the file over HTTP to the Worker, which parses it with the same code the MCP tools use and hands the Document model to the Durable Object, as `doc_open` already does (ADR-0016). They are not WebSocket Commands (ADR-0010): a 5 MB file does not belong in a gesture message. They run as the User Actor. The toolbar gets "Download SVG" beside the `.zibel.json` download and "Update from file…" (Replace); the Document list gets "Open file" (`.svg`, `.zibel.json`); dropping an SVG on the canvas or pasting SVG text is Place, at the viewport centre. Replace is only ever an explicit button.

## Fonts

`fontFamily` becomes any string, kept as written. A family Zibel does not have renders in the bundled font (ADR-0013), on the canvas as in `render`, with a `FONT_MISSING` warning on `node_create`, `node_update` and Open, and export writes the original name back, so the file shows the right font in Inkscape (F-TEXT-11, the "record the original name" part). Font upload and embedding are separate work.

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
- ADR-0013's one-font rule now holds for rendering only; the schema keeps any `fontFamily`. ADR-0013's "one `<text>` per Fill, then one per Stroke" gives way to the one-element rule above for a single Fill and Stroke.
- ADR-0011's deltas are kept for every rev for 30 days, not only for the 200 on the stacks: storage grows with edit volume rather than staying bounded by stack depth.
- `INVALID_DOCUMENT` now also covers SVG (F-MCP-15).
- New dependency `@xmldom/xmldom` in a new `packages/io`.
- After an Inkscape save, elements Zibel wrote without an id carry Inkscape's auto ids; import ignores them unless they are the only id on a new object.
- A moved object may come back with new `x`/`d` and identity `transform`; `doc_changes` shows both properties changed, which is what happened.
- F-IO-01, F-IO-03, F-IO-04, F-IO-05, F-IO-06, F-DRAW-01, F-DRAW-03, F-TEXT-11, §6.4, §7.2, §9 and Appendix A change to match (REQUIREMENTS decision 38).
