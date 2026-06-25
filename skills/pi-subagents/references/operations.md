# Operations Reference

Load this file for subagent lifecycle, async behavior, output artifacts, control signals, intercom, worktrees, clarify TUI, or troubleshooting.

## Async and Status

Prefer async mode for scouts, researchers, planners, workers, reviewers, validators, oracle checks, one-off delegates, chains, and parallel groups.

```typescript
subagent({ agent: "worker", task: "Run the focused validation suite.", async: true })
subagent({ action: "status" })
subagent({ action: "status", id: "run-id" })
```

Async does not permit parallel edits in the same active worktree. While an async worker edits, parent-side overlap should be read-only: inspection, validation prep, command planning, synthesis, or unaffected review.

If no independent work remains and waiting would only be sleep/polling, end the turn; Pi can deliver async completion when it arrives.

## Resume

Use `resume` for follow-up work on delegated runs:

```typescript
subagent({ action: "resume", id: "run-id", message: "Continue with the accepted fix only." })
subagent({ action: "resume", id: "run-id", index: 1, message: "Continue reviewer 2." })
subagent({ action: "resume", id: "nested-run-id", message: "Continue this nested reviewer." })
```

Behavior:

- If the child is still running and reachable, `resume` sends a live follow-up over intercom.
- If the child completed, `resume` revives a new async child from the persisted child session file.
- Multi-child async runs require `index` unless only one running child is selectable.
- Nested runs can be resumed by nested id when metadata is available.
- If no persisted `.jsonl` session exists, resume fails with a direct report.

## Output Artifacts

For large results, use `output` and `outputMode: "file-only"`:

```typescript
subagent({
  agent: "context-builder",
  task: "Write local architecture context for the auth flow.",
  output: "context-build/auth.md",
  outputMode: "file-only",
  async: true
})
```

`outputMode: "file-only"` returns a compact file reference instead of full content. Do not use `output: false` when an artifact is required; `output: false` means no file output.

Avoid duplicate output paths in parallel tasks. Concurrent children must not write the same output file.

## Chain Variables

Chain steps can use:

- `{task}`
- `{previous}`
- `{chain_dir}`
- `{outputs.name}` from a prior step or task with `as: "name"`

Prefer named outputs when a later step needs one specific result. Keep `{previous}` for simple linear handoffs or whole fan-in summaries.

Use `outputSchema` when later steps need reliable structured data. The child must call `structured_output` with schema-valid JSON or the step fails.

## Subagent Control

Control events are visibility and intervention signals, not proof of failure.

- `needs_attention`: no activity observed past threshold.
- `paused`: child turn was interrupted or is awaiting direction.
- `failed`: run failed.

Use soft interrupt only when the child is clearly blocked, drifting, or the parent/human needs to regain control:

```typescript
subagent({ action: "interrupt", id: "run-id" })
```

Bare `interrupt` does not target hidden nested descendants. Use explicit nested ids shown in status.

After interrupt, choose the next explicit action: resume with clearer instructions, replace the task, ask the user through the required UI, or stop the workflow.

Per-run thresholds can be raised for legitimately quiet long jobs:

```typescript
subagent({
  agent: "worker",
  task: "Run the slow migration test suite.",
  control: { needsAttentionAfterMs: 300000, notifyOn: ["needs_attention"] },
  async: true
})
```

## Intercom Coordination

`pi-subagents` works without `pi-intercom`. When `pi-intercom` is installed and enabled, the bridge may give child agents a private coordination channel back to the parent.

Children should prefer injected bridge tools such as `contact_supervisor`. They should not invent generic intercom targets.

Use `contact_supervisor` with `reason: "need_decision"` when:

- a child is blocked on a decision
- clarification is required before continuing safely
- approval, product, API, architecture, or scope choice is required

Use `reason: "progress_update"` only when:

- progress was explicitly requested
- discovery materially changes the plan
- a long-running child needs a concise checkpoint before normal return flow

Do not use `contact_supervisor` only to resolve review-only/no-project-edit versus progress-writing or output-artifact instructions. No-project-edit wins, while returning findings through the normal response or configured artifact is allowed unless parent set `output: false`.

If intercom messages do not appear, run:

```typescript
subagent({ action: "doctor" })
```

## Clarify TUI

Single and parallel runs support clarification TUI for previewing/editing parameters:

```typescript
subagent({ agent: "worker", task: "Implement feature X.", clarify: true })
```

Chains default clarify mode. Set `clarify: false` to skip it. Programmatic background launches should usually use `async: true` and avoid foreground clarify unless explicitly requested.

Clarify edits affect only the next run. Use management actions, settings, or agent files for persistent changes.

## Worktree Isolation

When multiple agents might write concurrently, isolate writers:

```typescript
subagent({
  tasks: [
    { agent: "worker", task: "Implement feature A." },
    { agent: "worker", task: "Implement feature B." }
  ],
  worktree: true,
  async: true
})
```

`worktree: true` gives each parallel task its own git worktree branched from `HEAD`. It expects clean git state for intentional parallel write workflows. If the workflow is one writer plus advisory agents, prefer the single-writer pattern instead.

## Forked Context

`context: "fork"` creates a branched child session from the current persisted parent session. It is not a fresh, filtered review context.

Use fork when the child should reason in a separate thread while inheriting the parent session's accumulated decisions, especially `oracle`.

Use fresh context for adversarial code review unless the user explicitly asks for forked context.

Forked runs can fail when the current parent session has no persisted session file. Use `context: "fresh"` when persistence is unavailable or unwanted.

## Error Handling

Unknown agent:

```typescript
subagent({ action: "list" })
```

Setup, discovery, or intercom confusion:

```typescript
subagent({ action: "doctor" })
```

Max subagent depth exceeded:

```text
Flatten the workflow or raise maxSubagentDepth in config.
```

Session manager did not return a session file:

```text
Persist the current session before using context: "fork", or use context: "fresh".
```

Intercom "Already waiting for a reply":

```text
Resolve the current outbound ask before starting another one.
```

Parallel output-path conflict:

```text
Give each parallel task a distinct output path, or disable output for tasks that do not need it.
```

Worktree launch fails:

```text
Ensure the git working tree is clean and task cwd overrides share the intended cwd.
```

Child fails before starting:

```text
Inspect status, artifact metadata/output logs, and doctor output. Extension loader errors usually appear in child output logs.
```
