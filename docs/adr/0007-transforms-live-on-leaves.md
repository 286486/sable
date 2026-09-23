---
status: accepted
date: 2026-09-23
---

# Transforms live on leaves as matrices; containers and parameters stay put

`node_transform` composes its matrix into each affected leaf's `transform`. It never rewrites a Live Shape's parameters or a Path's `d`, and a Layer or Group never carries a matrix: transforming a container transforms every leaf beneath it. A leaf's parameters and `d` are in its own coordinates, and `transform` maps them to the Document. `geometricBounds`, `visibleBounds` and `worldTransform` are always in document coordinates.

Rotating a rect keeps it a rect with its radius editable (F-DRAW-01). Illustrator's GroupItem and Layer have no matrix either, so this matches ADR-0005. Because containers stay identity, every tool input stays in document coordinates, including `node_create` inside a Group that was moved earlier, and nothing needs a matrix inverse.

## Considered Options

- **Bake into parameters and `d`** (Illustrator's Path behaviour): a rotated rect would have to become a Path, which loses its Live Shape parameters, and every type would need its own transform code.
- **Matrix on the container** (Figma-like): a Group move writes one row instead of one per leaf. The cost is that `node_create` inside a moved Group must set `transform = inverse(worldTransform(parent))` to keep inputs in document coordinates, and each container adds a coordinate space that Agents must reason about.

## Consequences

- Moving a Group or Layer writes one row per leaf and lists every leaf in `updatedIds` and `doc_changes`. The browser drag in #9 does the same.
- Once a Node is transformed, its `x y` or `d` no longer equal its document position. Agents read position from `geometricBounds`, and the tool descriptions say so.
- `scaleStrokes: true` (the default) needs no work, because the matrix scales Strokes. `false` divides the stored Stroke widths by the scale factor.
