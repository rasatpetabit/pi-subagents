---
name: pi-subagents
description: |
  Delegate work to builtin or custom subagents for single-agent, chain, parallel, async, forked-context, intercom-coordinated workflows. Use for advisory review, implementation handoffs, multi-step tasks where the parent should stay in control while other agents contribute context, planning, execution, review, validation, or background work.
---

# Pi Subagents

This skill is for the parent orchestrator only. Do not inject or follow it inside ordinary child subagents.

The parent session owns delegation, orchestration, synthesis, approvals, review fanout, and final completion. Children receive concrete role-specific tasks. Ordinary children must not launch subagent workflows. The only exception is an explicit fanout child whose resolved builtin `tools` includes `subagent`; that child may use `subagent` only for the fanout work assigned by the parent.

## Core Contract

- Prefer `async: true` for subagent launches unless foreground behavior is explicitly needed.
- Keep writes single-threaded in the active worktree. Parallelize reading, research, review, and validation. Use `worktree: true` only for deliberate isolated parallel writers.
- Use fresh-context `reviewer` agents for adversarial diff review. Use forked `oracle` when inherited decisions and context drift matter.
- Treat worker handoffs as intermediate until the parent inspects results, reviews when warranted, and verifies.
- Give implementation workers explicit acceptance criteria and evidence requirements. Use the structured `acceptance` field for broad, goal-style, PRD, plan, issue, workflow, UI, CLI, or risky work.
- Ask children to escalate unapproved product, API, architecture, or scope choices through `contact_supervisor` when bridge instructions provide it. Do not invent intercom targets.
- Review-only children may return findings in normal responses or configured output artifacts. Phrase constraints as "Do not modify project/source files" when `output` is configured.
- Keep host model routing, reviewer/advisor policy, and tier selection in `agent-dispatch`; do not duplicate that policy here.
- User-facing decision gates go through AUQ (`AskUserQuestion` / `ask_user_question`) on hosts that enforce it. Do not end a turn with a prose question.

## Load Details Only When Needed

- Read [references/workflows.md](references/workflows.md) before running multi-step implementation, review-loop, staged-fix, cleanup, parallel research, context-build, or handoff-plan orchestration.
- Read [references/operations.md](references/operations.md) for async lifecycle, status/resume/interrupt, control signals, intercom, output files, worktrees, clarify TUI, and error handling.
- Read [references/agent-authoring.md](references/agent-authoring.md) before creating, updating, overriding, deleting, or debugging custom agents/chains/settings.
- Prompt shortcuts live in `../../prompts/*.md`. If the user names a shortcut or asks for the same workflow, read the matching prompt template before translating it into `subagent(...)` calls.
- Builtin role prompts live in `../../agents/*.md`. Read the exact agent file before changing an agent, relying on subtle role behavior, or debugging child behavior.

## Choose the Shape

| Need | Default shape |
| --- | --- |
| Fast local recon | `scout`, usually fresh context, read-only |
| External docs/current evidence | `researcher`, with source links and confidence |
| Implementation plan | `planner`, no edits |
| Approved implementation | One async `worker`, single writer, explicit validation |
| Code/diff review | Fresh-context `reviewer` agents, distinct review angles |
| Decision-consistency check | Forked `oracle`, advisory only unless assigned otherwise |
| Generic small delegation | `delegate` |
| Several independent read-only tasks | Top-level `tasks` parallel group |
| Ordered handoff workflow | `chain` with named outputs when later steps need specific results |
| Long-running work | `async: true`, then `status`/`resume` as needed |
| Setup or discovery confusion | `subagent({ action: "doctor" })` |

## Builtin Agents

Builtin agents load at lowest priority. Project agents override user agents, and user/project agents override builtins with the same runtime name.

| Agent | Purpose | Default context |
| --- | --- | --- |
| `scout` | Fast codebase recon and handoff context | fresh |
| `researcher` | Web/docs/spec research brief with sources | fresh |
| `planner` | Implementation plan from existing context | fork |
| `worker` | Single-writer implementation for approved scope | fresh unless overridden by packaged config |
| `reviewer` | Evidence-backed review, optional small fixes unless review-only | fresh |
| `context-builder` | Structured context and meta-prompt artifacts | fresh |
| `oracle` | High-context advisory consistency check | fork |
| `delegate` | Lightweight generic child | fresh |

Builtin agents inherit the current Pi default model unless run, user, project, or agent settings override `model`. For model routing policy, use `agent-dispatch where` or `agent-dispatch digest`; names in examples are illustrative.

## Tool vs Slash Commands

Prefer `subagent(...)` when you are orchestrating agent logic. Prefer slash commands when guiding a human through an interactive flow.

Packaged prompt shortcuts are reusable recipes:

| Shortcut | Use for |
| --- | --- |
| `/parallel-review` | Fresh-context reviewers with distinct angles, then synthesis |
| `/review-loop` | Parent-controlled worker, reviewers, fix-worker cycles until clean or capped |
| `/parallel-research` | External evidence plus local code context |
| `/parallel-context-build` | Parallel `context-builder` passes that produce planning handoff context |
| `/parallel-handoff-plan` | External research plus local context into implementation-ready meta-prompt |
| `/gather-context-and-clarify` | Scout/research first, then clarification gate |
| `/parallel-cleanup` | Adversarial cleanup review passes, optionally autofix |

If a natural-language request clearly matches a shortcut, apply the same pattern directly through `subagent(...)`. Read the prompt file when exact sequencing matters.

## Minimal Invocation Patterns

Single child:

```typescript
subagent({ agent: "oracle", task: "Review current direction and challenge assumptions.", async: true })
```

Parallel read-only fanout:

```typescript
subagent({
  tasks: [
    { agent: "reviewer", task: "Review current diff for correctness regressions. Do not modify project/source files." },
    { agent: "reviewer", task: "Review current diff for test and validation gaps. Do not modify project/source files." },
    { agent: "reviewer", task: "Review current diff for unnecessary complexity. Do not modify project/source files." }
  ],
  context: "fresh",
  concurrency: 3,
  async: true
})
```

Sequential chain:

```typescript
subagent({
  chain: [
    { agent: "scout", task: "Map auth flow and summarize relevant files.", as: "authContext" },
    { agent: "planner", task: "Create an implementation plan from {outputs.authContext}.", as: "plan" }
  ],
  async: true
})
```

Worker with acceptance contract:

```typescript
subagent({
  agent: "worker",
  async: true,
  task: "Implement the approved plan at docs/example-plan.md. Preserve scope and report changed files, validation, and residual risks.",
  acceptance: {
    criteria: ["Approved plan implemented without widening scope", "Focused validation passes or failure is explained"],
    evidence: ["changed-files", "commands-run", "validation-output", "residual-risks"],
    stopRules: ["Stop and report if an unapproved product or architecture decision is required"],
    maxFinalizationTurns: 3
  }
})
```

Lifecycle and diagnostics:

```typescript
subagent({ action: "status" })
subagent({ action: "status", id: "run-id" })
subagent({ action: "resume", id: "run-id", message: "Continue with the accepted fix only." })
subagent({ action: "interrupt", id: "run-id" })
subagent({ action: "doctor" })
```

## Prompting Children

Use compact contracts, not long procedural scripts. Include only what the child needs:

- Goal: concrete outcome.
- Context/evidence: relevant files, diffs, plans, URLs, constraints.
- Success criteria: what must be true before finish.
- Hard constraints: true invariants only, such as review-only, single writer, no unapproved scope expansion.
- Validation: focused checks and acceptable fallback when checks cannot run.
- Output: summary shape or artifact path.
- Stop rules: when to escalate, ask through bridge, or stop after enough evidence.

Do not ask children to continue the parent conversation or create another subagent plan. Implementation children must use real edit/write tools instead of printing pseudo tool calls.

## Common Defaults

- For non-trivial implementation: clarify unresolved scope, define validation, plan when useful, run one async worker, review with fresh-context reviewers, synthesize, run one fix worker for accepted fixes, then parent verifies.
- For explicit review-loop requests: default max 3 review rounds unless the user sets a different cap.
- For broad diffs with many review findings: prefer staged fix orchestration: parallel read-only planners, one writer, then parallel validators.
- For large outputs: use `output` plus `outputMode: "file-only"` so parent receives a compact file reference. Do not use `output: false` when an artifact is required.
- For forked context: remember it is a branched child session, not a filtered fresh review context. If parent session is not persisted, fork can fail; use `context: "fresh"` when appropriate.

## Host Policy Pointer

On host, model routing, reviewer/advisor selection, subagent-dispatch tiers, and override policy are owned by **agent-dispatch**. Use `agent-dispatch where` for the repo root or `agent-dispatch digest` for live routing policy.
