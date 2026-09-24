# Drawing with Zibel

Read this once before your first write. Tool descriptions cover each call; this covers what holds across all of them.

## Coordinates

- Units are points (pt). The origin is the top-left of the Document; x grows right, y down.
- Every tool input (except a transformed Node's own parameters, below) and every `geometricBounds`, `visibleBounds` and `worldTransform` is in document coordinates. Artboards are regions of that one plane, not Nodes: read their placement from `artboards[].frame` in `zibel_doc_create` or `zibel_doc_get_info`, and add `frame.x` / `frame.y` to draw on an Artboard that is not at the origin.
- Angles are degrees, clockwise on screen. A `matrix` is `[a, b, c, d, e, f]` with SVG semantics.
- `zibel_node_transform` never rewrites a shape's parameters or a path's `d`: it gives the Node a `transform`. After that, the `x`, `y` or `d` you read with `zibel_node_get` (detail `full`) and write with `zibel_node_update` are in the Node's own coordinates; read where it is from `geometricBounds`. Layers and Groups never carry a transform, so creating Nodes inside a moved Group still takes document coordinates.

## Colours

- `#RRGGBB` or `#RRGGBBAA` only, case-insensitive: `#FF8800`, `#FF880080` for half opacity. No `rgb()`, no names, no 0–1 floats. An `INVALID_COLOR` hint gives the hex form of what you probably meant.
- Omit `appearance` for a white Fill and a 1 pt black Stroke (text: a black Fill, no Stroke). `{}` paints nothing.
- On `zibel_node_update`, a `fills` or `strokes` list you send replaces that list entirely, so include every Fill or Stroke you want to keep; a list you omit is kept.

## Path data (`d`)

- Absolute `M`, `L`, `C`, `Q` and `Z` only, uppercase. Numbers are stored with at most 3 decimals. Write `H` and `V` as `L`, `S` as `C`, `T` as `Q`, and arcs `A` as `C`.
- Start with `M x y`. Extra pairs after `M` are implicit `L`. `Z` closes the subpath.
- Example, a closed triangle and a curve: `M 0 0 L 100 0 L 50 80 Z M 0 100 C 30 60 70 140 100 100`.
- To cut a hole, make a Compound Path: put the hole as another subpath of the same `d` and set `fillRule: "evenodd"`, e.g. `M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 70 30 L 70 70 L 30 70 Z`. Under the default `nonzero`, an inner subpath is a hole only when it winds the other way.
- Prefer a Live Shape (`rect`, `ellipse`, `line`, `polygon`, `star`) to a path when one fits: its parameters stay editable.
- Only tool input is held to these commands: an SVG opened with `zibel_doc_open` may use any path data, and it is stored in this form.

## Structure

- A Document holds Artboards and Layers. Layers hold Groups and shapes; Groups hold Groups and shapes.
- Every Node you create needs `parentId`, the id of a Layer or Group, never an Artboard. A Layer's parent is the root (omit `parentId`) or another Layer. `zibel_doc_create` returns `defaultLayerId` for your first Nodes.
- Build Layers first, one per part of the picture (background, content, labels), then Groups inside them, then shapes. A `group` can carry its `children` inline in the same `zibel_node_create` call.
- Ids come from the server. Give each item a `clientKey` and read its new id from the receipt's `keyMap`.
- Give Layers and Groups a `name`. `tags` and `meta` are yours: use them to find Nodes again with `zibel_node_query`.
- Children are painted bottom to top in the order you create them.

## Clipping Masks

- To show artwork only inside a shape, draw the shape as a sibling of the artwork, then call `zibel_mask_make` with the shape as `clipNodeId` and the artwork as `contentIds`. They move into a new Group, the Clipping Mask, whose `geometricBounds` are the shape's.
- The shape becomes the Group's Clipping Path: it clips and is never painted, so it loses its Fills and Strokes, and it cannot be hidden. A text cannot clip yet.
- `clipping` is read-only to `zibel_node_update`: release with `zibel_mask_release`, which keeps the Group and leaves the shape unpainted.

## Workflow

1. Before a round of writes, call `zibel_doc_changes` with the `rev` you last saw (or `zibel_doc_get_info` the first time) to learn what a person changed since.
2. Create the skeleton: Layers and named, empty Groups.
3. Fill it in batches, one `zibel_node_create` per part.
4. Check with `zibel_render` and `overlays: ["bounds", "ids"]`, then fix what is off.
5. Guard key writes with `ifRev` set to the `rev` you last read: if anyone committed since, the write fails with `REV_CONFLICT` and changes nothing. Then call `zibel_doc_changes`, look at what changed, and retry.

## Transactions

- Use one when several writes should land and undo as one step, or when `zibel_doc_get_info` shows `browsers` above 0 and a person should not watch a half-built drawing.
- `zibel_tx_begin` returns a `txId`. Pass it to every write and to the reads (`zibel_node_get`, `zibel_node_query`, `zibel_doc_outline`, `zibel_render`, `zibel_export`) to see your uncommitted work. Nobody else sees it until `zibel_tx_commit`; put `intent` there. `zibel_tx_rollback` discards it.
- A Transaction rolls back after 5 minutes without a call carrying its `txId`.
- If someone deleted a Node you edited meanwhile, the commit fails with `NODE_GONE` and the Transaction stays open: roll it back and redo the work.

## Checking what you drew

- `zibel_render` returns a PNG of the whole Document, one Artboard, some Nodes or a rect. It lowers the scale to fit `maxSize` (default 1600 px); `viewport` maps pixels back to document coordinates.
- `zibel_export` with `format: "svg"` returns the drawing as SVG text when you need exact geometry.

## Saving and opening

- `zibel_export` with `format: "zibel_json"` returns the whole Document as `.zibel.json` text, the file to save.
- `zibel_doc_open` with that text as `content` makes a new Document with its own docId; every Node and Artboard keeps its id. A file that fails validation creates nothing, and `INVALID_DOCUMENT` (or the usual colour, path or parent code) names the `path` inside the file.
- `zibel_doc_open` also takes SVG text, told apart by content: Zibel's own `zibel_export` SVG, a file saved in Inkscape, or plain SVG 1.1, at most 5 MB (else `LIMIT_EXCEEDED`). Layers, pages, names, locks and `z-<id>` ids come back; units become pt, with px counting as pt. Clipping comes back as Clipping Masks. What Zibel cannot hold yet (gradients become their first colour; a clip it cannot hold, masks, filters, images and `<use>` are dropped) is listed once per kind in `warnings`; it never fails the open.
- To bring an edited file back into the Document it came from, use `zibel_doc_replace`, not `zibel_doc_open`: it keeps the docId and merges only what the file changed since its export onto what others wrote meanwhile, as one undoable Transaction. An SVG from `zibel_export` knows its rev; for a `.zibel.json`, pass the rev you exported it at as `baseRev`. Guard it with `ifRev` like any write.
- To add an SVG to a Document you are working on, use `zibel_svg_import`: it places the file as one new Group under the Layer or Group you name, with its layers as Groups and every id new, centred on the parent's Artboard or on `position`, and scaled to fit that Artboard with `fit: true`.

## Text

- `fontFamily` takes any font name and keeps it, so export writes it back. Only Source Sans 3 is bundled: another font renders and measures in it, and the receipt warns `FONT_MISSING`.

## Reading a Document

Go from coarse to fine: `zibel_doc_outline` for the Layer tree, `zibel_node_query` to find Nodes by type, name, tags, parent or area, and `zibel_node_get` for the properties of the few you will change.

## Errors

- A failed call returns `{code, message, hint, path}`: `hint` says what to do next and `path` names the field.
- A value the input schema rejects returns text starting `Input validation error:` that names the field.
- Common mistakes: an Artboard id as `parentId` (`INVALID_PARENT`), `rgb()` or named colours (`INVALID_COLOR`), lowercase or `H`/`V`/`A` path commands (`INVALID_PATH`), `transform` in a `zibel_node_update` patch (`INVALID_PATCH`: use `zibel_node_transform`), `parentId` in a patch (`INVALID_PATCH`: a Node cannot move to another parent yet), `clipping` in a patch (`INVALID_PATCH`: use `zibel_mask_make` or `zibel_mask_release`).

## Limits

- 2000 Nodes per `zibel_node_create`, counting inline children; 1000 per `zibel_node_update`, `zibel_node_delete` or `zibel_node_get`.
- Images at most 4096 px on their longer side.
- Pages of at most 1000 entries for `zibel_node_query` and `zibel_doc_changes`.
