# Spec — Unified delegation observability (live workflow + subagent view)

- **Slug/bundle:** `enhancement-ideas`
- **Date:** 2026-06-26
- **Repo:** `pi-subagents-fork` (skynet fork), branch `rasatpetabit/v0.30.0-skynet`
- **Complexity:** high
- **Source brainstorm decisions:** Approach A (adapter); two distinct effort columns
  (`tier` / `reasoning`); presentation-layer unification only; session-local scope.
- **Adversarial review incorporated** (cross-vendor, gpt-5.5 adversary lane, 2026-06-26):
  H1 (seam scope), H2 (effort≠tier), H3 (snapshot as source of truth), plus the two medium
  findings (adapter lifecycle/idempotency; shared-type fit) are folded into §3–§5 and §9.

## 1. Problem

The fork ships two sibling delegation tools — the original `subagent` tool and the newly
vendored, agent-dispatch-governed `workflow` engine. They have **asymmetric observability**:

- **Subagent side** has a mature live surface: a persistent pi-tui widget (`src/tui/render.ts`,
  `WIDGET_KEY`), a shared progress model (`AgentProgress` / `AsyncJobState` / `AsyncJobStep` in
  `src/shared/types.ts`), activity/aggregate formatting (`src/shared/status-format.ts`), and a
  live-state registry (`src/slash/slash-live-state.ts`).
- **Workflow side** tracks rich per-agent state (`WorkflowAgentSnapshot`: `id, label/role, phase,
  status, model, tokens, startedAt/endedAt` in `src/workflow-engine/display.ts`) and emits a full
  event stream from `WorkflowManager` (`agentStart`, `agentEnd`, `phase`, `tokenUsage`, `complete`,
  `error`) — **but its live rendering panel (the upstream task-panel) was intentionally excluded
  during vendoring** (see `src/workflow-engine/VENDOR.md`). All that remains is a thin text command
  (`/workflows status [id]`) that prints only `runId: status` — no agent list, no model, no effort.

The user wants one live view of active delegations where each agent shows its **role, model, and
effort level**. That is exactly the value the vendoring cut, and it is best delivered by *unifying*
the two tools onto the subagent side's existing live surface rather than rebuilding a second panel.

## 2. Goals / non-goals

**Goals**
- One session-local live view of all active delegations (subagent jobs **and** workflow agents).
- Per-agent columns: **role · model · tier · reasoning · status · phase · tokens · elapsed**.
- Reuse the existing subagent live widget + formatting helpers (no second display path).
- Stay vendor-safe: keep edits to the pinned `src/workflow-engine/` minimal and documented.

**Non-goals (explicitly deferred / rejected)**
- Cross-session or persistent run listing — deferred enhancement #3.
- Workflow-authoring DX / script lint — deferred enhancement #4.
- Any execution / identity / registry merge of the two engines (rejected Approach B — it maximizes
  the re-sync diff against the pinned upstream engine, per VENDOR.md).

## 3. Architecture — Approach A (adapter)

```
WorkflowManager (events = refresh triggers)        WorkflowManager.getRun().snapshot  (SOURCE OF TRUTH)
  agentStart / agentEnd / phase / tokenUsage / complete / error          │
        │   WorkflowProgressAdapter (NEW, outside the vendored dir) ──────┘ reads authoritative state
        ▼
shared progress model  (AgentProgress / AsyncJobState / AsyncJobStep)  ← subagent runs already feed here
        ▼
  ONE live widget (src/tui/render.ts WIDGET_KEY, extended: +role +model +tier +reasoning)
  ONE query command (/runs — unified active delegation view)
```

### 3.1 New code (outside the vendor)
- **`src/observability/workflow-progress-adapter.ts`** (name provisional): on each `WorkflowManager`
  event it **re-reads the authoritative snapshot** (`manager.getRun(runId).snapshot.agents`) and
  projects it into the shared model — events are *refresh triggers*, not the data source (see H3,
  §3.3). It registers/updates one job entry per run and one step per agent in the same live-state
  registry the widget reads. Must **never throw into the host** (mirror the try/catch discipline of
  `installResultDelivery` in `src/workflow-engine/register.ts`).

### 3.2 Vendor seam (H1 — scope honestly)
The display fields (`tier`, `agentType`) must be captured where model/tier are resolved (inside the
vendored `agent.ts` governance path) and made observable to the adapter. The existing
`onModelResolved?: (modelId) => void` at `agent.ts:273` (purpose already *"for display/telemetry"*)
is the anchor, but **one callback line is likely not sufficient**:
- **Late resolution:** a model/tier may resolve *after* `agentStart`. The adapter must update the
  step on `onModelResolved`/`agentEnd`, not assume the value exists at start.
- **Propagation must land on the snapshot** (not event-only): since the snapshot is the source of
  truth (§3.3), the resolved `{tier, agentType}` is written onto the `WorkflowAgentSnapshot` at the
  manager (`workflow-manager.ts:475` agentStart handler, and updated on `onModelResolved`/`agentEnd`
  for late resolution). Event-only enrichment is insufficient — the adapter reads the snapshot, not
  the event payload.
- **Footprint:** edits stay localized to the resolution path + the snapshot type, and are documented
  as a VENDOR.md "Local modifications" entry so a future upstream re-sync re-applies them (same
  discipline as the existing governance seam #3). Effort/tier→class is derived deterministically via
  the existing `mapTierToClass`; **no extra agent-dispatch call**.

### 3.3 Snapshot as source of truth (H3)
Reconstructing state purely from event deltas is fragile (missed / duplicated / out-of-order events;
events emitted before the adapter attaches; `tokenUsage` may be cumulative, not delta). Therefore:
- The adapter treats `WorkflowManager`'s in-memory `snapshot` (and `WorkflowAgentSnapshot`) as
  authoritative; on every event it **reads the current snapshot** and projects the whole run, rather
  than mutating from the event payload.
- **Initial sync on attach:** when the adapter registers, it enumerates already-active runs via the
  manager's run-listing API (`manager.listRuns()`) and projects each from its current snapshot — so a
  run already past `agentStart`/model-resolution is visible immediately, without waiting for another
  event. (Verify `listRuns()` exposes the per-run snapshot accessor for in-flight runs.)
- **Tokens** are read as the snapshot's absolute value, never accumulated from `tokenUsage` deltas.
- **Emit/mutate ordering:** "re-read snapshot on event" is correct only if `WorkflowManager` mutates
  the snapshot *before* emitting (verified for `agentStart` at `workflow-manager.ts:475`: the push
  precedes the emit). Confirm this for every event; where not guaranteed, coalesce the refresh to the
  next tick so a terminal/late event still converges to final state.

### 3.4 Shared model extension + adapter lifecycle (medium findings)
- **Additive types only:** add optional fields to the per-agent progress step in `src/shared/types.ts`
  — `role` (label/agentType), `model`, `tier`, `reasoning`. Both feeders populate only what applies;
  absent → `—`. Before mapping, **audit that `AsyncJobState`/`AsyncJobStep` actually model workflow
  phases/status/error semantics**; where they don't fit, extend additively rather than forcing a
  lossy mapping (do not assume subagent job/step assumptions transfer 1:1 to workflow agents).
- **Idempotent registration:** the adapter attaches exactly one listener set per manager; guard
  against duplicate attach (hot reload / re-registration) so events are not double-counted.
- **Teardown — per-run vs per-manager (H-new-2):** a run's terminal event (`complete`/`error`/
  `aborted`) triggers **per-run cleanup only** (finalize that run's projection; let it age out under
  `MAX_WIDGET_JOBS`). Manager/session **listener** detach happens only on session shutdown (or when no
  active runs remain *and* no further runs can occur). Completing one run must NOT detach the shared
  manager listeners — that would blind concurrent runs.
- Wired in `registerWorkflowTool` (`register.ts`) alongside `installResultDelivery` /
  `installWorkflowCommands`, under the same independent guard.

## 4. Effort columns — two distinct, honestly labeled (H2)

`tier` is the workflow **routing tier** — a coarse routing bucket, **not** a measure of compute
effort. `reasoning` is the subagent **model reasoning level** — the compute-effort axis. Keeping them
in separate, precisely-labeled columns avoids implying that a routing tier equals model effort.

| column      | meaning                                  | workflow agent             | subagent                          |
|-------------|------------------------------------------|----------------------------|-----------------------------------|
| `tier`      | routing bucket (NOT compute effort)      | `small` / `medium` / `big` | `—`                               |
| `reasoning` | model reasoning / compute level          | `—`                        | `minimal` / `low` / `medium` / `high` / `xhigh` |

- `tier` derives from the workflow agent's resolved tier (`resolveAgentModelSpec`). If a distinct
  resolved effort/class is genuinely available (`mapTierToClass` → task-class → effort) and adds
  signal, it may be shown as its own labeled value — but the spec does **not** present `tier` as if it
  were compute effort.
- `reasoning` derives from the subagent reasoning-level notion (`src/runs/foreground/chain-clarify.ts`,
  `src/shared/model-info.ts`).

## 5. Adapter projection (snapshot-driven)

On any `WorkflowManager` event for a run, the adapter reads `manager.getRun(runId).snapshot` and
projects: run → one job entry (`name`, `currentPhase`, aggregate counts, absolute `tokenUsage`); each
`snapshot.agents[i]` → one step `{ role: label, model, tier, reasoning?, phase, status, tokens
(absolute), startedAt, endedAt }`. Events (`agentStart/agentEnd/phase/tokenUsage/complete/error`) only
*trigger* a re-projection; they are not the data source (H3). Rendering reuses `status-format.ts`
(`formatActivityLabel`, `aggregateStepStatus`, `formatParallelOutcome`) and coalesces to the widget's
existing throttle cadence rather than re-rendering per event.

## 6. Surface

- **Live widget:** extend `src/tui/render.ts` so the `WIDGET_KEY` widget includes workflow runs next
  to subagent jobs and renders the new columns. Respect `MAX_WIDGET_JOBS`.
- **Command:** one unified query command, **`/runs`** (shows active runs of both kinds with the
  per-agent table). `/workflows status|stop` remains as workflow-specific control. *(Command name
  `/runs` chosen at brainstorm; confirm it's free at planning, else `/agents`.)*

## 7. Error handling

- Adapter isolated; any failure is caught and logged, never propagated into the host session
  (a single bad event must not crash Pi — same rationale as the `register.ts` `manager.on("error")`
  safety net).
- Missing `model` / `tier` / `reasoning` → graceful `—` / `unknown`, never a blank crash.
- Vendor footprint kept minimal and documented.

## 8. Testing (repo conventions: `node --test`, unit / integration split)

- **Unit:** snapshot→step projection (incl. late model resolution, H1); two-column population + `—`
  fallbacks; snapshot-as-source-of-truth robustness — out-of-order / duplicate / pre-attach events
  must not corrupt state (H3); **attach-after-running** (workflow already past `agentStart`/model
  resolution → `listRuns()` initial sync shows it immediately, no further event needed, H-new-1);
  **emit-before-mutate convergence** (synthetic manager emits an event before the snapshot mutates →
  adapter still converges to final state, H-new-3); **concurrent-run teardown** (two runs share a
  manager; complete/abort one → the other keeps updating, H-new-2); idempotent registration (double
  attach → single listener set); never-throw guard (malformed event/snapshot).
- **Render:** widget snapshot containing mixed workflow + subagent rows; column alignment with
  `MAX_WIDGET_JOBS` and truncation.
- **Integration:** run a small real workflow; assert it surfaces in the unified view with
  role / model / tier populated and reasoning `—`; assert teardown drops the finished run.

## 9. Risks / open questions

- **Vendor seam is more than one line (H1):** the tier/agentType propagation touches the resolution
  path *and* the snapshot type/event — must be in VENDOR.md's modification list or a re-sync drops it.
- **tier ≠ effort (H2):** label precisely; never present the routing tier as compute effort.
- **Event reliability (H3):** mitigated by snapshot-as-source-of-truth + initial-sync-on-attach;
  verify `WorkflowManager` exposes a stable per-run snapshot accessor for already-running runs.
- **Shared-type fit:** confirm `AsyncJobState`/`AsyncJobStep` model workflow phase/status/error
  cleanly; extend additively where not. Additive optional fields only, to avoid breaking the
  subagent path.
- **Command-name collision:** confirm `/runs` is free at planning time; fall back to `/agents`.
- **Throttle/perf:** a wide fan-out emits many events; the adapter must coalesce re-projection to the
  widget's existing cadence rather than per-event.
