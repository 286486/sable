# Sable

A vector drawing tool that runs in the browser, built so AI agents can read and write the document through MCP while a person edits the same file in a normal Illustrator-style canvas.

The name is from Kolinsky sable, the brush hair used for fine illustration work.

## Status

Requirements stage. There is no code in this repository yet. What exists is a requirements document and the research it was built from.

Start here:

| Document | Contents |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Requirements v0.2. Scope, functional requirements, MCP tool surface, architecture, milestones, Illustrator feature mapping |
| [docs/research/01-illustrator-core-features.md](docs/research/01-illustrator-core-features.md) | Adobe Illustrator tools, panels, workflows and scripting DOM, from the official user guide |
| [docs/research/02-web-vector-tech-landscape.md](docs/research/02-web-vector-tech-landscape.md) | Figma, Penpot, Excalidraw, tldraw and Graphite architecture; rendering, boolean, text, freehand and sync library choices |
| [docs/research/03-mcp-design-tool-patterns.md](docs/research/03-mcp-design-tool-patterns.md) | How existing MCP servers expose design tools, and what breaks |

## What it is meant to do

Three kinds of work, all producing editable vector output rather than images:

- Charts and diagrams, from data or from a Mermaid description
- Illustration, icons and logos, with Bezier paths, boolean operations, gradients and an appearance stack
- Freehand drawing with pressure, fitted to editable curves

Agents drive it over MCP. Every edit a person can make in the UI has a matching tool call, and every write returns both the affected node IDs and an optional rendered preview, so an agent can check its own work.

## Planned shape

- Document model is a flat, ID-keyed scene graph serialised as readable JSON
- Rendering starts on Canvas2D and moves to Skia via CanvasKit as object counts grow
- Boolean operations use Skia PathOps; text is shaped with HarfBuzz
- Hosted on Cloudflare, with one Durable Object per document holding authoritative state, plus a local Node mode over stdio for self-hosting
- Monorepo under `apps/` and `packages/`, laid out in REQUIREMENTS.md section 8.3

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Sable name and logo are not covered by that licence.
