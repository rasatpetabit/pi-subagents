# Plan: pi-intercom-usage

## Task 1: Shared result delivery helper
**Status:** pending | **Wave:** 0  
**Files:** `src/intercom/result-intercom.ts`, `src/runs/foreground/subagent-executor.ts`, `src/runs/background/result-watcher.ts`  
Extract `deliverSubagentResultGrouped(events, input)` from the repeated `buildSubagentResultIntercomPayload` + `deliverSubagentResultIntercomEvent` pattern in foreground and background paths.

## Task 2: Memoized target resolver
**Status:** pending | **Wave:** 0  
**Files:** `src/intercom/intercom-bridge.ts`, `src/runs/foreground/subagent-executor.ts`, `src/runs/background/subagent-runner.ts`  
Add `createTargetResolver(runId): (agent: string, index?: number) => string` with internal WeakMap memoization so repeated calls with same args return cached target.

## Task 3: Bridge instruction template tests
**Status:** pending | **Wave:** 1  
**Files:** `test/unit/intercom-bridge.test.ts`  
Add tests for `buildIntercomBridgeInstruction` covering: marker prefixing, `{orchestratorTarget}` substitution, raw template passthrough.

## Task 4: Extension doctor integration verification
**Status:** pending | **Wave:** 1  
**Files:** `test/unit/doctor.test.ts`, `src/extension/doctor.ts`  
Add focused test that verifies `diagnoseIntercomBridge` output structure via doctor integration (active/inactive states).
