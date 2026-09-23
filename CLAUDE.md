# Zibel

Browser-based vector drawing tool with an MCP-native document model: AI agents and people edit the same Illustrator-style canvas. Requirements stage; no product code yet. Read `docs/REQUIREMENTS.md` before proposing scope or architecture changes, and `docs/research/` for the evidence behind it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `286486/zibel`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.

## Conventions

- Code, identifiers, comments, commit messages, ADRs and this file are in English.
- `docs/REQUIREMENTS.md` and `CONTEXT.md` are in Chinese for now; translate to English before the M1 public announcement and keep the Chinese copies under `docs/zh/`.
- Canonical terms come from `CONTEXT.md` and follow Adobe Illustrator's names. Use `compound_shape`, not `boolean`; `Actor`, not `session`.
- MCP is stateless Streamable HTTP only (ADR-0006). Never add stdio, `Mcp-Session-Id`, subscriptions, or elicitation.
