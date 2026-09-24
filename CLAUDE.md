# Zibel

Browser-based vector drawing tool with an MCP-native document model: AI agents and people edit the same Illustrator-style canvas. Read `docs/REQUIREMENTS.md` before proposing scope or architecture changes, and `docs/research/` for the evidence behind it. Milestones are in its §9.

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

## Roles

Roles are bound to models, whichever model runs the main session:

- **Fable plans and reviews.** Plans come from the `planner` agent; finished work is judged by the `reviewer` agent. The advisor (also Fable) checks the plan and the final result from inside the session.
- **Opus implements and tests.** When the main session is Opus it implements directly; when it is Fable it dispatches the `implementer` agent.

If the model a role needs is unavailable, stop and tell the user. Run each role on its own model only.

Routing gotchas:

- `subagent_type: "fork"` always inherits the parent model and ignores `model`. Dispatch planning and review as `planner` / `reviewer`, never as a fork.
- Skills that spawn their own subagents (such as `code-review`) use the default model. For result review use `reviewer`; if a skill must be used, pass `model: "fable"` to its dispatch.
- `.claude/agents/*.md` load at session start. After editing them, restart the session before relying on them.
- A `/advisor` change takes effect only after `/clear` or `/compact`.

## Workflow

Every change passes these gates in order. A gate is done only when its criterion holds.

When a task starts through the `implement` skill, first give the user a short summary of the task in Chinese (what it builds and why), before any gate.

When a task is done (gate 8 merged), end by recommending the next task to the user, in Chinese: one open issue whose `Blocked by` issues are all closed, preferring the one that unblocks the most on the way to the current milestone's exit criteria. Say why it wins over the other unblocked issues, and name the command that starts it.

1. **Issue.** Work starts from a GitHub issue. Done: the issue states the goal and cites requirement IDs (`F-…`), and is labelled `ready-for-agent`.
2. **Grill.** Needed when the change touches more than one package, alters the MCP tool surface or document schema, or introduces a term. Run `/mattpocock-skills:grill-with-docs`. Done: no open question left, `CONTEXT.md` and `docs/adr/` updated per `docs/agents/domain.md`.
3. **Plan (Fable).** Dispatch `planner` with the issue number; it posts the plan as an issue comment. When the main session is Opus, call the advisor on the plan. Done: the plan comment lists units, each with its red test and the command that turns it green.
4. **Worktree.** Never switch branches in the main checkout. Create a worktree at `.claude/worktrees/<issue-number>-<slug>` on a new branch `<issue-number>-<slug>` from `origin/main` (`EnterWorktree`, or `git worktree add -b`), and run `pnpm install` in it. Gates 5–7 run inside it. When dispatching `implementer` or `reviewer`, pass the worktree path; do not use `isolation: "worktree"`, which creates a second one. Remove it after gate 8 merges the branch. Done: the worktree exists on the new branch.
5. **Implement (Opus).** One unit at a time: test red, smallest change to green, `pnpm check`, commit. Use `/mattpocock-skills:tdd` when the unit has a cheap test target. Done: every unit green and committed.
6. **Verify (Opus).** `pnpm check` (typecheck, Biome, Vitest in workerd via `@cloudflare/vitest-plugin`) plus the suites the change reaches:
    - MCP tools, schemas or `skill://` docs: agent benchmarks in `fixtures/agent-benchmarks/` (`pnpm bench`, local only).
    - `packages/io` or `packages/render`: the Inkscape round trip over `fixtures/documents/` (`pnpm roundtrip`, also a CI job). It needs `inkscape` ≥ 1.2 on `PATH`; a skip is not a pass.
    - `packages/geometry`: boolean and offset regression fixtures.

    Done: all green, with the output kept for the merge commit. Until M0 creates these scripts and fixtures, say which checks did not exist.
7. **Review (Fable).** Dispatch `reviewer` with the issue number and base `origin/main`. Opus fixes every blocking finding; `reviewer` runs again. Then call the advisor as the pre-done check. Done: verdict **approve**.
8. **Merge.** No pull request. In the main checkout, on `main`, run `git merge --no-ff <branch>` with a message that carries `Closes #<n>`, the reviewer verdict and the verify output, then `git push origin main`. Add a Changeset first when a published package changes. Then remove the worktree and delete the branch, locally and on `origin`. Done: `main` pushed and the issue closed.
