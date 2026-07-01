# Spec: pi-intercom-usage

## Problem

The intercom subsystem (`src/intercom/`) provides coordination between subagent runs and their orchestrators (session targeting, bridge instructions, result delivery). It is used extensively across foreground and background execution paths, but has accumulated some structural inefficiencies:

1. **Result delivery duplication:** Foreground (`subagent-executor.ts`) and background (`result-watcher.ts`) paths build `buildSubagentResultIntercomPayload` + `deliverSubagentResultIntercomEvent` with nearly identical logic, inline. A shared delivery wrapper would reduce the copy-and-paste surface.

2. **Intercom target resolution redundancy:** `resolveSubagentIntercomTarget(runId, agent, index)` is called repeatedly with the same arguments across execution flows (e.g., per-child in parallel, per-step in chains). These calls are deterministic and could be memoized within a single run using a `Map`, but each call does string concatenation de novo.

3. **Bridge instruction template coverage:** `DEFAULT_INTERCOM_BRIDGE_TEMPLATE` and `buildIntercomBridgeInstruction` are core to child agent behavior but lack test coverage for template substitution and marker prefixing.

4. **Doctor integration verification:** `diagnoseIntercomBridge` is exposed via `doctor.ts` with a focused test verifying active/inactive bridge state reporting.

## Goals

- **Task 1:** Extract a shared `deliverSubagentResult` helper (or inline composition) so that foreground and background paths share the payload-building + delivery logic.
- **Task 2:** Add memoized intercom target resolution (`createTargetResolver(runId)`) to reduce redundant string work in multi-child flows.
- **Task 3:** Add unit tests for `buildIntercomBridgeInstruction` (template substitution, marker prefixing).
- **Task 4:** Verify the extension doctor schema exposes `diagnoseIntercomBridge` with a focused integration fixture.

## Scope

- **In scope:** `src/intercom/`, `src/runs/foreground/subagent-executor.ts`, `src/runs/background/result-watcher.ts`, related unit tests.
- **Out of scope:** Intercom event bus wiring (`src/runs/shared/subagent-control.ts`), extension fanout child (`src/extension/fanout-child.ts`), `src/runs/background/async-resume.ts`.

## Non-goals

- Redesigning the intercom event bus contract.
- Changes to the `pi-intercom` npm package itself (owned by separate repo).
