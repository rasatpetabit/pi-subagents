---
type: reference
title: Agent profile & override resolution
timestamp: 2026-07-01T00:00:00Z
privacy: private
tags: [pi-subagents, profiles, agents, config]
---

# Agent profile & override resolution

Resolves builtin agent definitions (`agents/*.md`) against user/project
`settings.json` overrides (model, thinking, tools, skills, prompt) with
precedence rules, producing the live runtime agent configuration used when
a subagent is dispatched.

## Where it lives

- `agents/*.md` — frontmatter+prompt definitions for the builtin roles:
  `scout.md`, `researcher.md`, `planner.md`, `worker.md`, `reviewer.md`,
  `context-builder.md`, `oracle.md`, `delegate.md`.
- `src/agents/agent-management.ts` and `src/agents/agents.ts` — the bulk of
  agent resolution/management logic (largest files in `src/agents/`,
  ~44KB and ~50KB respectively).
- `src/agents/agent-selection.ts` — logic for selecting which agent role
  to use for a given dispatch.
- `src/agents/agent-serializer.ts` — serializes resolved agent
  configuration.
- `src/agents/frontmatter.ts` — parses the YAML frontmatter in
  `agents/*.md` role definitions.
- `src/agents/skills.ts` and `src/agents/proactive-skills.ts` — resolve
  which skills a given agent role has access to, including proactive
  skill suggestions.
- `src/profiles/profiles.ts` — resolves model/agent overrides and
  settings.json precedence into the final runtime agent config.
- `src/slash/prompt-template-bridge.ts` — bridges reusable prompt
  templates (`prompts/`) into slash-command-driven agent invocations.

## Builtin roles (from agents/)

`scout`, `researcher`, `planner`, `worker`, `reviewer`, `context-builder`,
`oracle`, `delegate` — each with its own frontmatter+prompt file under
`agents/`.
