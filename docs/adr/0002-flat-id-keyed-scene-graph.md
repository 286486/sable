---
status: accepted
date: 2026-09-23
---

# Flat, ID-keyed scene graph with parent as a field

The document stores every node in one map keyed by a stable ID; parent and sibling order are data fields (`parentId` plus a fractional-index string), not nested child arrays. Agents address nodes by ID in every tool call, concurrent inserts must not renumber siblings, and each edit should be expressible as "set property P on node N". Figma, tldraw and Excalidraw all converged on this shape.

## Considered Options

- **Nested tree (children arrays)**: matches SVG and reads naturally, but moves and reorders rewrite whole arrays, diffs are noisy, and concurrent edits to one parent conflict.

## Consequences

- Tree invariants (no cycles, Layer parents only Layer or root, Group never contains Layer) are enforced by core on every command, because the storage shape does not enforce them.
- Children of a node are an index lookup, maintained alongside the map.
