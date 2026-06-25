# Vendored: pi-dynamic-workflows engine core

This directory is a **pinned, trimmed vendor** of the deterministic workflow
engine from [`gtnotacoder/pi-dynamic-workflows`](https://github.com/gtnotacoder/pi-dynamic-workflows),
imported as a sibling `workflow` tool to this fork's `subagent` tool.

## Provenance

- **Upstream**: `gtnotacoder/pi-dynamic-workflows` (MIT). Lineage: gtnotacoder ←
  QuintinShaw ← upstream Pi workflow primitive (a port of Claude Code's native
  `Workflow`).
- **Pinned commit**: `9f63c70e1767ddcaa07f2961edf6583fb04ce9ed` (release `0.1.7`,
  2026-06-24).
- **Scope**: the engine *core* only — the transitive import closure of
  `src/workflow-tool.ts` + `src/workflow.ts` (19 files, ~5.6k LOC). The upstream
  **command/UI surface is intentionally excluded** (`deep-research`,
  `code-review`, `adversarial-review`, `web-tools`, `task-panel`, the slash-command
  and editor modules) — this fork already covers those via the deep-research
  skill, `/code-review`, and agent-dispatch cross-review.

## Why vendor (not adopt the package)

The engine fills a genuine gap: a deterministic, journaled-resume, cost-bounded,
*imperative* fan-out engine usable from a top-level Pi session — something stock
`pi-subagents` (declarative `parallel`/`async`/`fanout`) cannot express. But the
package's model resolution is **ungoverned** (it bypasses the agent-dispatch
guard). Vendoring lets us keep the engine's in-process spawn (preserving resume +
`getSessionStats` cost accounting) while routing model selection through
agent-dispatch at the single resolution seam. See the repo `WORKLOG.md`.

## Local modifications (keep this list current)

1. **Import specifiers** rewritten `./*.js` → `./*.ts` to match this fork's
   convention and Node's `--experimental-strip-types` runtime.
2. **`errors.ts`**: `enum WorkflowErrorCode` → `as const` object + union type
   (strip-types does not support TS enums). Behavior-preserving; values identical.
3. **`agent.ts` (governance seam)**: model resolution routed through
   `agent-dispatch resolve`/`guard` (fail-closed); outcomes recorded via
   `agent-dispatch record`. _(see that file's `GOVERNANCE` markers)_

## Re-syncing with upstream

Re-fetch the same 19 files at a newer pinned commit, re-apply the rewrites in
(1)–(2), and re-apply the governance seam (3). The seam is localized to
`agent.ts`'s model-resolution functions, so a diff against the pinned upstream
`agent.ts` shows exactly what to re-apply.
