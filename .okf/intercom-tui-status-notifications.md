---
type: reference
title: Intercom/TUI status & notifications
timestamp: 2026-07-01T00:00:00Z
privacy: private
tags: [pi-subagents, intercom, tui, slash-commands]
---

# Intercom/TUI status & notifications

Tracks and renders live status of running/background subagents (compact
async widgets, completion notifications, grouped chain/parallel progress)
and provides slash-command introspection into the subagent system.

## Where it lives

- `src/intercom/intercom-bridge.ts` — bridges run status/events between
  the execution engine and the notification layer.
- `src/intercom/result-intercom.ts` — carries completed subagent results
  back to the parent session/UI.
- `src/tui/render.ts` — the largest TUI file (~78KB); renders async run
  status widgets and clarification prompts in the terminal.
- `src/tui/render-helpers.ts` — shared rendering helper functions.
- `src/slash/slash-commands.ts` — implements slash commands including
  `/subagents-models` and `/subagents-doctor` (also present as
  `src/extension/doctor.ts`) and `/run`.
- `src/slash/slash-live-state.ts` — live state tracking backing the slash
  commands' introspection output.
- `src/slash/slash-bridge.ts` — bridges slash command invocations into
  the extension.

## Purpose (per README/exploration)

Gives the user visibility into subagent activity that isn't inline
foreground streaming — e.g. checking on a background run later, seeing
grouped progress for a parallel/chain workflow, and diagnosing extension
health via `/subagents-doctor`.
