# Sable

Browser-based vector drawing tool with an MCP-native document model: AI agents and people edit the same Illustrator-style canvas. Requirements stage; no product code yet. Read `docs/REQUIREMENTS.md` before proposing scope or architecture changes, and `docs/research/` for the evidence behind it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `286486/sable`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
