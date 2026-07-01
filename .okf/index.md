---
type: index
title: pi-subagents-fork knowledge catalog
timestamp: 2026-07-01T00:00:00Z
privacy: private
tags: [pi-subagents, pi-coding-agent, subagents, typescript, extension]
---

# pi-subagents-fork knowledge catalog

`pi-subagents-fork` is a personal fork (rasatpetabit context) of the
upstream `nicobailon/pi-subagents` npm package, version `0.31.0`. It is a
Pi coding-agent extension that lets the Pi CLI delegate work to focused
child "subagent" sessions: code review, research, planning, implementation,
parallel audits, and background jobs, via a small set of builtin agent
roles and configurable chains/workflows.

Pi is the parent session; a subagent is a focused child Pi session with
its own job. Foreground subagent runs stream inline in the parent
conversation; background runs keep working asynchronously and can be
checked later. Installing the extension only registers a delegation tool
for Pi — it does not start any automatic behavior on its own.

## Tech stack

- TypeScript / Node.js (ESM), using `node --experimental-strip-types`
- Pi coding-agent extension API: `@earendil-works/pi-agent-core`, `pi-ai`,
  `pi-coding-agent` (peer deps)
- `pi-tui` for terminal UI widgets
- `typebox` for schema validation, `jiti` for module loading
- Node built-in test runner (tests under `test/`)

## Key components

- `src/extension/` — main Pi extension entrypoint (`index.ts`), the
  subagent tool registration, slash-command wiring, `doctor.ts`
  (`/subagents-doctor`), `fanout-child.ts`, and `schemas.ts`.
- `src/agents/` — builtin agent role logic: agent management/resolution
  (`agent-management.ts`, `agents.ts`), agent selection, agent/chain
  serialization, frontmatter parsing, and skill discovery
  (`skills.ts`, `proactive-skills.ts`).
- `agents/*.md` — frontmatter+prompt definitions for each builtin agent
  role: `scout`, `researcher`, `planner`, `worker`, `reviewer`,
  `context-builder`, `oracle`, `delegate`.
- `src/runs/{foreground,background,shared}/` — execution engine for
  streaming (foreground) vs async/background subagent runs.
- `src/intercom/` — status/notification/messaging layer
  (`intercom-bridge.ts`, `result-intercom.ts`) giving visibility into
  async run progress.
- `src/profiles/profiles.ts` — resolves model/agent overrides and
  project/user settings against builtin agent definitions.
- `src/slash/` — slash command implementations, including
  `/subagents-models`, `/subagents-doctor`, `/run`, and prompt-template
  bridging.
- `src/tui/render.ts` — terminal UI rendering for async run status and
  clarification prompts.
- `skills/pi-subagents/` — packaged skill shipped to Pi for
  discoverability.
- `prompts/` — reusable prompt templates for orchestration workflows.

## Docs and pointers

- `README.md` (repo root) — primary user-facing documentation: install
  instructions (`pi install npm:pi-subagents`), example prompts for
  delegating to `reviewer`, `oracle`, `scout`, `planner`, `worker`, and
  parallel/chain workflows.
- `CHANGELOG.md` (repo root) — version history.
- `docs/masterplan/` — the repo owner's own masterplan planning scratch
  space (spec.md, plan.md, state.yml, events.jsonl for two workstreams:
  `pi-intercom-usage` and `enhancement-ideas`). This is user planning
  content layered onto the fork, not upstream project documentation.

## Notes

No repo-local `AGENTS.md` or `CLAUDE.md` exists in this repo as of this
writing. This is believed to be a personal fork of the upstream
`nicobailon/pi-subagents` project (see `package.json` `repository` /
`homepage` fields, which still point at `nicobailon/pi-subagents`).
