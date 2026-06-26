# WORKLOG — pi-subagents-fork

Terse handoff log for collaborating agents/sessions. Read before substantive
work; append a dated entry (scope + why, not what — the diff shows what) before
ending.

## 2026-06-25 — fix "request a workflow, get nothing": foreground default + background result delivery

Scope: `src/workflow-engine/workflow-tool.ts` (default flip), `src/workflow-engine/register.ts`
(`installResultDelivery` + `installWorkflowCommands`), new unit tests
`test/unit/workflow-tool-default.test.ts` + `test/unit/workflow-result-delivery.test.ts`.

Why: user reported "requesting workflows, not getting any." Root-caused live (not a
registration failure — the tool IS registered/active; a `pi -p` repro confirmed the
model calls it). The engine ran to completion (RED/BLUE written to the run JSON,
`status: completed`) but the result never reached the conversation: the tool
**defaulted to `background: true`** and promised "the result is delivered back
automatically," while the delivery mechanism (upstream task-panel) was **excluded by
the vendoring cut** (VENDOR.md). So: launch → run finishes on disk → silence.

Fix (user chose "Both"):
- **Foreground by default** — `workflow-tool.ts:221` `params.background ?? true` → `?? false`.
  A plain "run a workflow" now blocks on `runSync` and returns the result inline this
  turn. Schema description + prompt guideline + comment updated; background is explicit
  opt-in. **Live-verified** via `pi -p`: returned `red: RED / blue: BLUE` inline.
- **Background delivery** — `installResultDelivery(pi, manager)` listens on the manager's
  `"complete"` event and, gated on `getRun(runId)?.background` (foreground already
  returned inline) + per-run dedupe, delivers via `pi.sendMessage({…}, { triggerTurn: true })`
  (mirrors `runs/background/notify.ts`). Plus `/workflows status [id] | stop <id>`.
  NOTE: background delivery is **not** headlessly verifiable (`pi -p` exits before a
  detached result lands) — proven at unit level (3/3); **needs a confirm in a live
  interactive session**. With foreground now default, this path only runs on explicit
  `background: true`, so the unit test is the primary guard.
- Both installs wrapped in their own try/catch in `register.ts` so a failure there can
  never block the critical-path tool registration.

Also fixed a separate pre-existing integration failure surfaced during this work:
`fork-context-execution` "top-level parallel config overrides for maxTasks". Despite the
name it was **not** a maxTasks logic bug — the cap honors the config override fine.
Diagnostic showed `EACCES … /tmp/subagent-artifacts/…_input.md`, callCount=0: the test
hardcoded `sessionFile: "/tmp/parent.jsonl"`, and per-subagent input files are written to
`<sessionDir>/subagent-artifacts` (`shared/artifacts.ts`), i.e. world-shared
`/tmp/subagent-artifacts` — created Jun 24 by UID 1005 (grojas) mode 775, so `ras` can't
write (sticky `/tmp`, not removable without privileges). Only this test trips it (it's the
sole sibling whose cap passes and then actually spawns agents; the "Max 8" test rejects
before any write). Fix: isolate its session file under `tempDir`, matching the
already-isolated parallel/count tests in the same file. No production code involved.

Suites after both fixes: unit 587/587, integration 392/392.

## 2026-06-24 — vendored governed `workflow` engine (deterministic fan-out, sibling to `subagent`)

Scope: new `src/workflow-engine/` (vendored pi-dynamic-workflows engine core) +
governance seam + registration + tests. Also added an `agent-dispatch record` CLI
verb in `/srv/dev/ai/agent-dispatch` (the ledger contract this engine calls).

Why: evaluation concluded stock `pi-subagents` covers *declarative* fan-out, but
the one thing it cannot express is *imperative* programmable orchestration
(loop-until-dry, budget-scaled fan-out, no-barrier pipeline). pi-dynamic-workflows
implements exactly that, but ungoverned. Decision: vendor the engine, not adopt
the package, and govern it at the single model-resolution seam.

Key decisions / non-obvious facts:
- **Vendored core only** (19 files / ~5.6k LOC = transitive closure of
  `workflow-tool.ts`+`workflow.ts`), pinned at upstream `9f63c70` (v0.1.7). The
  upstream slash-command/UI surface (deep-research, code-review, web-tools,
  editors, task-panel) is **deliberately excluded** — covered elsewhere. See
  `src/workflow-engine/VENDOR.md`.
- **Governance is a GATE, not a re-route** (`governance.ts`). The engine keeps its
  IN-PROCESS `createAgentSession` spawn (so journaled resume + `getSessionStats`
  cost survive); we gate the *effective model* via `agent-dispatch guard` BEFORE
  the spawn at `agent.ts` resolveAgentModelSpec call-site. haiku→deny,
  sonnet→override_required throw `GovernanceDenied`; **fail-closed** if guard is
  unreachable for a disposition-keyed model.
- **Only disposition-keyed Anthropic specs are guarded** (haiku/sonnet/opus/fable).
  Served/local models (glm-5.2, qwen36-27b, nemotron) are passed through —
  `agent-dispatch guard` reports raw served names as "unsupported" (deny), so
  guarding them would false-deny. Routing tier→served-model is a FOLLOW-UP (needs
  the Pi ModelRegistry to carry the gateway entries).
- Outcomes recorded via `agent-dispatch record` (best-effort, never throws).
- `errors.ts` enum → `as const` (strip-types has no enums); fixed the
  index-child-registration test fixture to capture the `subagent` tool by name
  (it now coexists with `workflow`). Child mode (`SUBAGENT_CHILD_ENV`) returns
  before registration, so workers get no engine — intended.
- **Scope of enforcement (don't over-read the green suite):** the MECHANISM is
  proven — a pre-spawn `agent-dispatch guard` gate coexists with in-process
  journaled resume + `getSessionStats` cost. COVERAGE today is named Anthropic
  dispositions only (haiku/sonnet/opus/fable). The user's `defaultModel` is glm-5.2
  and workers spawn served models, all of which hit `dispositionKey → null →
  pass-through` (no guard call, so fail-closed governs nothing on that path). Real
  day-to-day governance arrives with tier→approved-served-model routing — the
  explicit FOLLOW-UP, not this cut.
- Guard contract probed against the live CLI (2026-06-24): opus/fable→allow,
  haiku→deny, sonnet→deny ("requires live override grant"). The earlier stub
  spelled sonnet's verdict `override_required`; reconciled to the real `deny`
  (engine rejects any non-`allow` identically, so enforcement was already correct).
  Note: the gate passes no override path to `guard`, so a *granted* sonnet would
  still be denied — safe direction (over-denies), revisit if sonnet grants matter.
- Remaining validation gap: a LIVE end-to-end (real Pi session invoking the tool,
  forbidden model rejected at runtime) is not yet run — enforcement is proven at
  unit level (`test/unit/workflow-governance.test.ts`, 9/9) and the seam is wired.
- Suites green: unit 575/575, integration 390/390. agent-dispatch `record`: 4/4.

## 2026-06-24 — append-channel suppression is already guaranteed (regression test added)

Scope: added `test/unit/append-channel-suppression.test.ts`. No behavior change.

Why: evaluation of `gtnotacoder/pi-dynamic-workflows` (Pi workflow engine) asked
whether to adopt its OpenCode-style `inheritMainRules:false` ("main-agent rules
don't leak into subagents"). Finding: **this fork already has that property**,
for free. We spawn subagents via the Pi CLI and always pass the role prompt with
`--append-system-prompt`/`--system-prompt` (`src/runs/shared/pi-args.ts:~143`).
Pi's resource loader resolves the append channel as
`appendSystemPromptSource ?? discoverAppendSystemPromptFile()`
(`@earendil-works/pi-coding-agent` `dist/core/resource-loader.js:~335`), so
supplying that arg short-circuits auto-discovery of `.pi/APPEND_SYSTEM.md` /
`~/.pi/agent/APPEND_SYSTEM.md`. Verified empirically with the real loader: bare
spawn → sentinel inherited; fork-style append spawn → sentinel absent. The
package needs an explicit flag only because it spawns via the in-process SDK
(role supplied via a different option, leaving discovery to fire) — a different
mechanism. Conclusion: do not adopt the package; do not thread an
`inheritMainRules` flag (would be dead code).

The new test locks the invariant so a future refactor that stops passing a
prompt path (which would let Pi re-discover and inherit APPEND_SYSTEM.md) fails
loudly. Full unit suite green (566/566), lint: n/a (no repo biome config — see 2026-06-25 validation entry).

## 2026-06-24 — LIVE end-to-end validation (real guard) found + fixed 2 more bugs

Scope: ran the full path through the real `WorkflowManager.runSync` + the REAL
`agent-dispatch guard` subprocess (not the stub). Added a durable live integration
test (`test/integration/workflow-governance-live.test.ts`).

The e2e caught two bugs that ALL unit tests + both cross-vendor review rounds missed
(the stub masked them):
- **consultGuard mis-handled the deny exit code.** The real `agent-dispatch guard`
  exits NON-ZERO (code 2) on a deny while printing the verdict JSON on stdout; the
  unit stub did `process.exit(0)`. So `execFileSync` threw on every real deny →
  `consultGuard` fell to the catch → fail-closed `guard_unavailable` instead of a
  clean `deny`. Enforcement still HELD (rejected either way) but with the wrong
  verdict/reason. Fix: `consultGuard` now parses `err.stdout` on a non-zero exit and
  only treats a genuinely unparseable/missing-binary result as unavailable. Stub
  updated to exit 2 on deny (faithful) so the suite actually covers this.
- **WorkflowManager.emit("error") with no listener crashes the host.** `register.ts`
  built the manager but attached no `"error"` listener; Node throws
  ERR_UNHANDLED_ERROR on `emit("error")` with none, so the FIRST failing workflow
  (governance denial, agent error, timeout) would take down the Pi session — even
  though `runSync` rejection is separately caught. Fix: `register.ts` attaches a
  quiet safety-net `"error"` listener (failure is still surfaced via the tool result).

Live e2e now: forbidden haiku → `GovernanceDenied` code `GOVERNANCE_DENIED` verdict
`deny` recoverable `false` (clean, correct reason). The lease is a lockfile (no
timer/fd) and IS released on failed runs (workflow-manager.ts:570) — no leak; the
test runner's lingering handle is the MCP harness, so `test:integration` now passes
`--test-force-exit` (forces exit only AFTER tests settle; the 390 existing tests are
unaffected). Suites: unit 582/582, integration 391/391 (0 skipped), lint: n/a (no repo biome config — see 2026-06-25 validation entry).

## 2026-06-24 — adversarial-review dev cycle + governance seam hardening (3 findings → fixed)

Scope: stood up a working cross-vendor adversarial-review cycle and ran it on the
governance seam (`governance.ts`, `agent.ts`, `errors.ts`, `test/unit/workflow-governance.test.ts`).

**The cycle (the deliverable):** `codex exec` → `gpt-5.5` via the `headroom`
provider (cross-vendor to Claude). The sanctioned `agent-dispatch review --class
adversary` lane is currently DEAD — not because the gateway is down (skynet_health
shows gpt-5.5 + dispatch-* lanes served + reachable on gateway-epyc1/epyc2) but
because `agent-dispatch health dispatch-gateway` FALSE-NEGATIVES (its
`configured_model` is skynet3, which only serves qwen36-27b-w8a8, so the review
verb skips its only reviewer → "no healthy reviewers"). `codex exec` bypasses that
broken probe entirely. **Cadence lesson:** xhigh codex review exceeds the 10-min
foreground cap; iteration reviews must use `-c model_reasoning_effort="low"` and
"do NOT run any secondary/qwen pass" — reserve xhigh for a final gate.

**Round-1 review found 3 real holes the 9/9 unit suite missed** (the unit tests
exercised `governModelSpec` in isolation, never the `agent.ts` spawn path):
- P1: untagged agent (no model/tier, no medium config) → `resolveAgentModelSpec`
  undefined → pass-through, but `createAgentSession` then inherits the Pi session
  DEFAULT model — ungated.
- P2: `sessionOptions.model` flowed into `createAgentSession` via `...sessionOptions`
  without being gated.
- P3: `GovernanceDenied` was a plain Error → `wrapError` mapped it to recoverable
  `AGENT_EXECUTION_ERROR` → retried into a silent `null` (fail-closed-at-spawn held,
  but the denial signal was swallowed).

**Fixes (this commit):**
- Gate the EFFECTIVE model right before `createAgentSession` via
  `effectiveModelSpec(resolvedModel ?? sessionOptions.model ?? getDefaultModel())` —
  precedence mirrors the spawn-option spread (P1 configured-default + P2 closed).
- `GovernanceDenied extends WorkflowError` with non-recoverable `GOVERNANCE_DENIED`
  code → `wrapError` passes it through → `workflow.ts` throws (hard abort) (P3 closed).
- +6 unit tests (effective-spec precedence, P1/P2 deny, served pass-through, P3
  terminality). Suites: unit 581/581, integration 390/390, lint: n/a (no repo biome config — see 2026-06-25 validation entry).

**Round-2 re-review:** P2 + P3 confirmed structurally closed. P1 narrowed to a
RESIDUAL edge (Codex verdict, low effort): real forbidden-spawn risk ONLY when
`resolvedModel` undefined AND `sessionOptions.model` undefined AND no usable saved
`defaultProvider+defaultModel` AND the SDK's `availableModels[0]` is haiku/ungranted-
sonnet. Benign whenever the SDK's `defaultModelPerProvider` fallback matches
(anthropic default = `claude-opus-4-7`, allowed). **Does NOT bite this deployment**
(default = served `glm-5.2`). **CLOSED via fail-closed** (user decision): `governModelSpec`
now throws `GovernanceDenied(undeterminable_model)` when `effectiveSpec` is empty, and
`agent.ts` treats the saved default as usable only when BOTH `getDefaultProvider()` +
`getDefaultModel()` are set (the SDK's own branch-1 condition, `model-resolver.js`).
So a no-usable-default untagged spawn is refused rather than risking the SDK's
unverifiable fallback. Probed this env: provider=`litellm`, model=`glm-5.2` (both set)
→ concrete spec → never hits fail-closed. Rejected the alternative (hardcoding the
SDK-internal `defaultModelPerProvider`) as fragile — it is not exported via the package
`exports` map. Suites after fix: unit 582/582, integration 390/390, lint: n/a (no repo biome config — see 2026-06-25 validation entry).

**Also outstanding (sync clobber):** the `agent-dispatch record` verb added earlier
this session was LOST when the agent-dispatch tree was reset from `main` to branch
`fix/bounded-edit-failclosed-regression-test` (Syncthing pull from the sendreceive
writer). `agent-dispatch guard` still works; `record` returns "Unknown subcommand",
so `recordOutcome` is a silent no-op (best-effort, non-breaking). Needs recreating on
the now-current branch before the ledger hook works / before merge.

## 2026-06-25 — thorough end-to-end validation (all green; one cross-vendor HIGH adjudicated unreachable)

Scope: full re-validation of the governance seam against the REAL binaries + a
cross-vendor adversarial review of the final committed diff. No behavior change —
only a load-bearing-invariant comment at `agent.ts` (before `createAgentSession`) and
this entry + the WORKLOG lint correction below.

Empirically verified (not trusting prior summaries):
- Suites: fork unit **582/582**, integration **391/391 (0 skipped — the LIVE e2e test
  actually spawned the real `agent-dispatch guard`, 3.8s)**, agent-dispatch `record` **4/4**.
- Real guard contract, probed with the BARE disposition keys the engine actually
  sends (`consultGuard(dispositionKey)`, not the full spec): `haiku`→deny (exit 2,
  "forbidden; no override path"), `sonnet`→deny (exit 2, "requires live override
  grant"), `opus`→allow (exit 0), `fable`→allow (exit 0). Deny prints verdict JSON on
  stdout AND exits 2; consultGuard's err.stdout catch-path parses it. **No false-deny
  of opus/fable** — the earlier worry that the guard might reject bare keys is closed.
- Real `record` verb accepts the engine's exact payload (`backend:"workflow-engine"`),
  writes a canonical ledger row (`latency_s` from `duration_ms`, synthesized
  `dispatch_id`), and rejects missing `task_class`/`outcome` (exit 1). The sync-clobber
  item above is RESOLVED — verb recreated, committed `4a33890` on agent-dispatch main.

Cross-vendor review (codex→gpt-5.5) raised ONE HIGH: the gate models the SDK's model
precedence as `resolved ?? sessionOption ?? settingsDefault` but the SDK
(`sdk.js:108-130`) has a middle tier — restore `existingSession.model` from a
persisted transcript. **Adjudicated REAL-but-UNREACHABLE** against SDK source:
`SessionManager.create()` passes `sessionFile=undefined` → constructor `newSession()`
(`session-manager.js:499-512,542-566`) → brand-new empty session, never scans the dir
→ `hasExistingSession` always false → tier-2 restore never fires, **even on resume**
(per-run `transcriptDir` is populated but `.create` still opens a NEW file). Second,
independent reason: the gate runs before every spawn, so a post-gate transcript can
never hold a forbidden model. Fix applied = a load-bearing comment locking the
invariant (if anyone later adds `SessionManager.open()`/`continueRecent()` resume,
the gate MUST add `existingSession.model` to the precedence). Reviewer's "pin the
governed Model into createAgentSession" fix was REJECTED — on the no-per-call-model
path we intentionally let the SDK apply the (already-governed) settings default;
pinning would add behavior risk to a dead path. No regression test added (the
invariant is structural + commented; a test would be gold-plating).

WORKLOG correction (faithful reporting): prior entries' "biome clean" claims are
**unverifiable** — there is no `biome.json` anywhere in the repo and biome is not a
declared dependency; running default-config biome flags untouched UPSTREAM files too
(e.g. `src/agents/agents.ts`). The governance files sit in the same stylistic
ballpark as upstream. Those four "biome clean" lines were rewritten to "lint: n/a".

## 2026-06-25 — compacted `pi-subagents` skill hot path
Scope: rewrote `skills/pi-subagents/SKILL.md` as a 169-line orchestration router and moved detailed recipes into one-hop `references/` files. Why: reduce automatic skill-load context cost without losing workflow functionality. Decision: keep parent-only invariants, async-first/single-writer rules, core tool shapes, and host policy pointer in hot path; move long workflow, operations, and agent-authoring detail behind progressive disclosure. Validation: skill validator clean, reference/prompt paths resolved, `git diff --check` clean, unit suite **582/582**.
