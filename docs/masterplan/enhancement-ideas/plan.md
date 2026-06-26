# Plan — Unified delegation observability

**Run:** `enhancement-ideas` · **Repo:** `pi-subagents-fork` (skynet fork, branch `rasatpetabit/v0.30.0-skynet`) · **Complexity:** high
**Goal:** one session-local live view of all active delegations (subagent jobs **and** workflow agents), each agent showing role · model · **tier** (routing bucket, not effort) · **reasoning** (model effort) · status · phase · tokens · elapsed — delivered by unifying the two engines onto the subagent side's existing live surface (Approach A, adapter).

**Decomposition source:** governed `architecture` opus-tier dispatch seeded tasks 1–4; the parent orchestrator completed and wrote both artifacts (orchestrator-as-writer — `architecture` is chat-only, so the parent writes the run-bundle files). No ad-hoc child model override was used.

## Wave grouping

- **Wave 0 — foundational (parallel-safe, disjoint files).** The typed surface the rest reads from: (1) additive optional step fields; (2) the vendor seam that makes `{tier, agentType}` observable on the snapshot. These unblock every later task.
- **Wave 1 — build the two presentation feeders (parallel-safe, disjoint files).** (3) the adapter that projects the authoritative snapshot into the shared model; (4) the widget that renders the unified view. Both depend only on wave 0.
- **Wave 2 — wire + query (parallel-safe, disjoint files).** (5) register the adapter against the workflow manager; (6) the unified `/runs` command. Both depend on wave 1.
- **Wave 3 — end-to-end proof.** (7) one integration test exercising the real event stream through the wired adapter.

## Tasks

### Task 1 — Shared-model additive step fields (wave 0)
- **Files:** `src/shared/types.ts`
- **Verify:** `npm run test:unit`
- **What:** Add optional `role`, `model`, `tier`, `reasoning` to `AsyncJobStep`. Optional-only / type-additive; absent → existing dash fallback. Both feeders populate only what applies. **codex: ok** (mechanical, single file, concrete verify).

### Task 2 — Vendor seam: capture `{tier, agentType}` (wave 0)
- **Files:** `src/workflow-engine/agent.ts`, `display.ts`, `workflow-manager.ts`, `VENDOR.md`
- **Verify:** `npm run test:unit`
- **What:** Capture resolved `{tier, agentType}` at `agent.ts` `onModelResolved` (~L273), late-resolution-safe (update on `onModelResolved`/`agentEnd` too); add the pair to `WorkflowAgentSnapshot` in `display.ts`; write it in `workflow-manager.ts` at the `agentStart` handler (~L475, push-before-emit) and on resolution/end; document as a VENDOR.md "Local modifications" entry so re-sync re-applies it. Snapshot is source of truth; events are refresh triggers. **codex: no** (cross-file taste + vendor seam).

### Task 3 — WorkflowProgressAdapter (wave 1)
- **Files:** `src/observability/workflow-progress-adapter.ts` (NEW, outside vendor), `test/unit/workflow-progress-adapter.test.ts`
- **Verify:** `node --experimental-strip-types --test test/unit/workflow-progress-adapter.test.ts` · `npm run test:unit`
- **What:** On each `WorkflowManager` event, RE-READ `manager.getRun(runId).snapshot` and project run→one job / agent→one step into the shared model (task-1 fields). Snapshot-driven (H3): initial-sync-on-attach via `listRuns()`; per-run cleanup on terminal event with manager-listener detach only on shutdown; idempotent registration; never-throw into host; coalesce re-projection. The unit test must cover late model resolution, two-column population + dash fallbacks, out-of-order/duplicate/pre-attach robustness, attach-after-running, emit-before-mutate convergence, concurrent-run teardown, idempotent attach, and the never-throw guard. **codex: no** (new engineering + adversarial-event robustness).

### Task 4 — Widget: tier + reasoning columns (wave 1)
- **Files:** `src/tui/render.ts`, `test/unit/render-observability-columns.test.ts`
- **Verify:** `node --experimental-strip-types --test test/unit/render-observability-columns.test.ts` · `npm run test:unit`
- **What:** Extend the `WIDGET_KEY` widget with two DISTINCT columns — `tier` (routing bucket, **not** compute effort, dash for subagents) and `reasoning` (model level, dash for workflow agents) — reusing `status-format.ts` helpers and respecting `MAX_WIDGET_JOBS`. Render snapshot unit test for a mixed row set + alignment. **codex: no** (taste + large-file edit).

### Task 5 — Register the adapter (wave 2)
- **Files:** `src/workflow-engine/register.ts`
- **Verify:** `npm run test:unit`
- **What:** Attach the adapter in `registerWorkflowTool` alongside `installResultDelivery` / `installWorkflowCommands`, same independent guard + try/catch/never-throw discipline; one listener set per manager (idempotent); a single bad event never crashes the host. **codex: no** (seam wiring).

### Task 6 — Unified `/runs` command (wave 2)
- **Files:** `src/slash/slash-commands.ts`
- **Verify:** `npm run test:unit` · `npm run test:integration`
- **What:** New `/runs` reads the shared live-state registry (`slash-live-state.ts`) and prints the unified active-delegation table (both engines, per-agent columns). `/workflows status|stop` stays for workflow control. Confirm `/runs` is free (fall back to `/agents`). Single data source — no second path. **codex: no** (cross-engine read surface).

### Task 7 — Integration: end-to-end observability (wave 3)
- **Files:** `test/integration/unified-observability.test.ts`
- **Verify:** `node --experimental-transform-types --import ./test/support/register-loader.mjs --test --test-force-exit test/integration/unified-observability.test.ts` · `npm run test:all`
- **What:** Run a small real foreground workflow; assert it surfaces in the unified view with role/model/tier populated and reasoning `—`; assert per-run teardown on completion. Cross-engine end-to-end proof. **codex: no** (live integration).

## Routing summary
- codex ok: 1 (task 1) · codex no: 6 (tasks 2–7) · none null.
- Waves: 4 (wave 0: 1,2 · wave 1: 3,4 · wave 2: 5,6 · wave 3: 7). Every same-wave pair has disjoint `files`.

## Risks / open questions (carried from spec §9)
- **Vendor seam > one line:** the tier/agentType propagation touches resolution path + snapshot type + handlers; must stay in VENDOR.md's modification list or a re-sync drops it (task 2).
- **tier ≠ effort:** label precisely; never present the routing tier as compute effort (task 4, task 6).
- **Event reliability:** mitigated by snapshot-as-source-of-truth + initial-sync-on-attach; confirm `WorkflowManager` exposes a stable per-run snapshot accessor for already-running runs (task 3).
- **Shared-type fit:** confirm `AsyncJobState`/`AsyncJobStep` model workflow phase/status/error cleanly; extend additively where not (task 1, task 3).
- **Command-name collision:** confirm `/runs` is free at implementation; fall back to `/agents` (task 6).
- **Throttle/perf:** wide fan-out emits many events; the adapter must coalesce re-projection to the widget cadence, not re-render per event (task 3, task 4).
