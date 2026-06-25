# WORKLOG — pi-subagents-fork

Terse handoff log for collaborating agents/sessions. Read before substantive
work; append a dated entry (scope + why, not what — the diff shows what) before
ending.

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
loudly. Full unit suite green (566/566), biome clean.

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
  terminality). Suites: unit 581/581, integration 390/390, biome clean.

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
`exports` map. Suites after fix: unit 582/582, integration 390/390, biome clean.

**Also outstanding (sync clobber):** the `agent-dispatch record` verb added earlier
this session was LOST when the agent-dispatch tree was reset from `main` to branch
`fix/bounded-edit-failclosed-regression-test` (Syncthing pull from the sendreceive
writer). `agent-dispatch guard` still works; `record` returns "Unknown subcommand",
so `recordOutcome` is a silent no-op (best-effort, non-breaking). Needs recreating on
the now-current branch before the ledger hook works / before merge.
