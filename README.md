# Zibel

A vector drawing tool that runs in the browser, built so AI agents can read and write the document through MCP while a person edits the same file in a normal Illustrator-style canvas.

Zibel is a short form of Zobel / zibeline, the sable marten whose hair makes the finest illustration brushes.

## Status

Milestone M0 is in progress (issue #1). A local Worker already takes MCP calls to create a Document, draw rectangles into it, read its outline and render it to PNG. There is no browser UI yet.

Start here. Domain vocabulary is in [CONTEXT.md](CONTEXT.md) and architecture decisions in [docs/adr/](docs/adr/).

| Document | Contents |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Requirements v0.4 (Chinese). Scope, functional requirements, MCP tool surface, architecture, milestones, Illustrator feature mapping |
| [docs/research/01-illustrator-core-features.md](docs/research/01-illustrator-core-features.md) | Adobe Illustrator tools, panels, workflows and scripting DOM, from the official user guide |
| [docs/research/02-web-vector-tech-landscape.md](docs/research/02-web-vector-tech-landscape.md) | Figma, Penpot, Excalidraw, tldraw and Graphite architecture; rendering, boolean, text, freehand and sync library choices |
| [docs/research/03-mcp-design-tool-patterns.md](docs/research/03-mcp-design-tool-patterns.md) | How existing MCP servers expose design tools, and what breaks |

## Local development

Needs Node 22 or later.

```sh
corepack enable
pnpm install
pnpm check   # typecheck, Biome, and Vitest inside workerd
pnpm dev     # wrangler dev, MCP at http://localhost:8787/mcp
```

Every MCP request needs `Authorization: Bearer <dev token>`. The dev tokens and the Agent Actor each one maps to are in `DEV_TOKENS` in [apps/edge/wrangler.jsonc](apps/edge/wrangler.jsonc). Documents are stored under `.wrangler/state` and survive a restart of `pnpm dev`.

To connect Claude Code, copy [examples/claude-code.mcp.json](examples/claude-code.mcp.json) to `.mcp.json`, or run:

```sh
claude mcp add --transport http zibel http://localhost:8787/mcp -H "Authorization: Bearer dev-token-a"
```

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
- Hosted on Cloudflare, with one Durable Object per document holding authoritative state; the same Worker bundle runs locally under `wrangler dev` and self-hosted under workerd
- MCP is stateless Streamable HTTP only: no stdio, no MCP sessions, every request carries its own token and document address
- Monorepo under `apps/` and `packages/`, laid out in REQUIREMENTS.md section 8.3

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Zibel name and logo are not covered by that licence.
