---
status: accepted
date: 2026-09-22
---

# TypeScript core, WASM only for geometry hotspots

`core` (document model, commands, transactions, queries, schema) runs in the browser and inside Cloudflare Durable Objects, and the MCP tool schemas (zod), the UI property panels and the document JSON must share one set of types. So core is TypeScript, not Rust compiled to WASM as in Penpot or Graphite. Only geometry hotspots use existing WASM modules: Skia PathOps for booleans and stroke outlining, HarfBuzz for text shaping, resvg / CanvasKit for rendering.

## Considered Options

- **Rust core + WASM, TypeScript as glue**: better raw performance, but Graphite's gains are in rendering rather than the document model; types would need generating across the language boundary, and debugging inside a DO gets harder.
- **All TypeScript, geometry included**: Paper.js's long-standing boolean edge-case bugs show that rewriting robust path booleans is not worth it.

## Consequences

- Rendering bottlenecks are solved by swapping the `render` backend (Canvas2D to CanvasKit), not by rewriting core.
- core's CI runs its tests inside `workerd` and may not use Node-only APIs.
- If core itself ever proves too slow, migrating is expensive. This is an accepted trade-off.
