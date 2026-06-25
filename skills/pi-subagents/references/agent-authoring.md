# Agent Authoring Reference

Load this file before creating, updating, overriding, deleting, or debugging custom agents, chains, settings, or discovery precedence.

## Discovery and Precedence

Agent files can live in:

- `~/.pi/agent/agents/**/*.md` - user scope
- `.pi/agents/**/*.md` - canonical project scope
- `.agents/**/*.md` - legacy compatibility; `.pi/agents/` wins on conflicts

Chains can live in:

- `~/.pi/agent/chains/**/*.chain.md`
- `~/.pi/agent/chains/**/*.chain.json`
- `.pi/chains/**/*.chain.md`
- `.pi/chains/**/*.chain.json`

Discovery is recursive. `.chain.md` files do not define agents.

Precedence by parsed runtime name:

1. project scope
2. user scope
3. builtin agents

Agents and chains can set optional frontmatter/package metadata. `name: scout` plus `package: code-analysis` registers runtime name `code-analysis.scout` while serialization keeps `name` and `package` separate.

## Management Actions

Use management actions when the system needs to create or edit subagents on demand without raw file editing.

List available agents/chains:

```typescript
subagent({ action: "list" })
```

Create an agent:

```typescript
subagent({
  action: "create",
  config: {
    name: "my-agent",
    package: "code-analysis",
    description: "Project-specific implementation helper",
    systemPrompt: "Your system prompt here.",
    systemPromptMode: "replace",
    tools: "read,grep,find,ls,bash"
  }
})
```

Update an agent:

```typescript
subagent({ action: "update", agent: "code-analysis.my-agent", config: { thinking: "high" } })
```

Delete an agent:

```typescript
subagent({ action: "delete", agent: "code-analysis.my-agent" })
```

`config.name` is the local frontmatter name. Optional `config.package` registers lookup runtime name `{package}.{name}`. Use the dotted runtime name for `get`, `update`, `delete`, slash commands, and chain steps.

For small builtin tweaks such as a model swap, prefer `subagents.agentOverrides` in settings instead of copying the full builtin agent file.

## Minimal Agent File

```markdown
---
name: my-agent
package: code-analysis
description: What this agent does
thinking: high
tools: read, grep, find, ls, bash
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---
Your system prompt here.
```

Omit `package` for a traditional unqualified runtime name.

Common optional fields:

- `model`
- `fallbackModels`
- `defaultProgress`
- `defaultReads`
- `output`
- `maxSubagentDepth`
- `inheritProjectContext`
- `inheritSkills`
- `defaultContext`
- `disabled`
- `skills`
- `tools`
- `systemPrompt`

Use model fields only when the host policy permits it. On this host, consult `agent-dispatch where` or `agent-dispatch digest` for live routing policy instead of hardcoding model policy in this skill.

## Settings Overrides

Settings locations:

- user scope: `~/.pi/agent/settings.json`
- project scope: `.pi/settings.json`

Example shape:

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "thinking": "high",
        "fallbackModels": ["provider/model-name"]
      }
    }
  }
}
```

User overrides apply everywhere. Project overrides apply only in the repo and win over user overrides.

Override builtin defaults before copying full agent files; a small settings change is usually enough.

## Prompt Template Integration

Prompt shortcuts live in `../../../prompts/`:

- `parallel-review.md`
- `review-loop.md`
- `parallel-research.md`
- `parallel-context-build.md`
- `parallel-handoff-plan.md`
- `gather-context-and-clarify.md`
- `parallel-cleanup.md`

Use prompt templates when a repeatable workflow should always run through a particular agent shape, output behavior, context mode, or sequence.

If `pi-prompt-template-model` is installed, additional user prompt templates can delegate into `pi-subagents`. This is useful when a slash command should always run through a specific agent or forked context.

## Agent Editing Guidance

- Keep custom agents focused on role behavior, not parent orchestration.
- Put parent workflow rules in this skill or prompt templates, not in ordinary child agents.
- Give child agents clear escalation behavior for unapproved decisions.
- Do not give ordinary children `subagent` unless they are intentionally fanout-capable and bounded by `maxSubagentDepth`.
- For review-only roles, make no-edit behavior explicit and allow configured output artifacts when needed.
