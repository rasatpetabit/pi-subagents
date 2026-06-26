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
4. **`workflow-tool.ts` default flipped to FOREGROUND** — `params.background ?? true`
   → `?? false`. Upstream defaults to background because it ships the task-panel that
   re-delivers detached results; we excluded that surface, so a background default
   meant "run a workflow → result lands on disk → conversation gets nothing." Inline
   default returns the result in-turn; background is explicit opt-in.
5. **`register.ts` re-adds a minimal delivery surface** the excluded task-panel used to
   provide: `installResultDelivery` (manager `"complete"` → `sendMessage`, gated on
   `background` + dedupe) and `installWorkflowCommands` (`/workflows status|stop`). NOT
   the upstream live task-panel — just enough that an opt-in background run is
   retrievable. Re-applying (4)/(5) on re-sync: both are localized to those two files.
6. **`display.ts`/`workflow.ts`/`workflow-manager.ts` (tier/agentType propagation seam)** —
   `WorkflowAgentSnapshot` (display.ts) carries `tier?: string` and `agentType?: string`;
   the `onAgentStart` event (workflow.ts, cached + live paths) threads `tier`/`agentType`
   from `agentOptions`; the manager's `agentStart` handler (workflow-manager.ts ~L475) writes
   them onto the snapshot push so the enhanced-progress adapter can read them.
   _(enhancement-ideas §2, vendor seam)_.
7. **`register.ts` (workflow-progress adapter seam)** —
   `registerWorkflowTool(pi, state)` accepts the `SubagentState` so the enhanced-progress
   adapter (`WorkflowProgressAdapter` from the greenfield `src/observability/` directory)
   can attach alongside `installResultDelivery`/`installWorkflowCommands` under the
   same independent try/catch guard. _(enhancement-ideas §5)_. Re-applying (7): a single
   import + parameter + adapter-attach block in `register.ts`.

## Re-syncing with upstream

Re-fetch the same 19 files at a newer pinned commit, re-apply the rewrites in
(1)–(2), and re-apply the governance seam (3), tier/agentType seam (6), and
adapter-attach seam (7). All seams are localized to their named files, so a diff
against the pinned upstream shows exactly what to re-apply.
