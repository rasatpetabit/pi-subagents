---
type: reference
title: Subagent dispatch & execution engine
timestamp: 2026-07-01T00:00:00Z
privacy: private
tags: [pi-subagents, execution, runs, dispatch]
---

# Subagent dispatch & execution engine

Core logic for launching child Pi sessions ("subagents"), managing
foreground streaming vs background async runs, chains/parallel groups,
context forking/filtering, and depth-limited nested fanout with
child-safety boundaries.

## Where it lives

- `src/extension/index.ts` — registers the subagent tool that the parent
  Pi session calls to dispatch a child run.
- `src/extension/fanout-child.ts` — handles nested/parallel fanout of
  child subagent runs.
- `src/runs/foreground/` — streaming execution path: child output is
  surfaced live in the parent conversation.
- `src/runs/background/` — async execution path: child runs continue
  independently and can be polled/checked later (surfaced via the
  intercom layer).
- `src/runs/shared/` — logic shared between foreground and background run
  paths.
- `src/agents/chain-serializer.ts` — serializes chain/parallel-group
  definitions for multi-step or multi-agent workflows.

## Behavior (per README)

- A subagent is a focused child Pi session with its own job; the parent
  Pi session starts it, hands it the task, and receives the result back.
- Foreground runs stream inline in the conversation; background runs work
  independently and are checked later.
- Supports parallel dispatch (e.g. "run parallel reviewers: one for
  correctness, one for tests, one for unnecessary complexity") and
  chained workflows (e.g. scout → planner → worker → reviewer loop, with
  a max round count).
- Installing the extension only exposes the delegation tool to Pi; it
  does not start automatic background behavior unless explicitly
  requested in a prompt or project instructions.
