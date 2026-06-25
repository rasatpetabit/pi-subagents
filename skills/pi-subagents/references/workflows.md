# Workflow Recipes

Load this file only when the parent is about to orchestrate a multi-step workflow. Keep orchestration authority in the parent session.

## Shared Workflow Rules

- Prefer async orchestration. Launch the run, continue local inspection or validation prep, then check status when results are needed.
- Keep active-worktree writes single-threaded. Parallel children should normally be read-only reviewers, researchers, scouts, planners, or validators.
- Children should receive concrete role-specific tasks. Do not tell ordinary children to run subagents or manage the parent loop.
- Reviewers inspect the repository and current diff directly. They should not rely on the parent or worker's reasoning.
- Synthesize child outputs before applying anything. Separate blockers, fixes worth doing now, optional/deferred feedback, and feedback to ignore with a short reason.
- Ask the user before applying fixes that require unapproved product, API, architecture, or scope choices.

## Clarify, Plan, Implement, Review

Use for new features, broad fixes, risky behavior changes, workflow changes, UI/CLI changes, or any task where success criteria are not obvious.

Default sequence:

```text
clarify unresolved scope -> define validation -> plan if useful -> async worker -> fresh reviewers/validators -> fix worker -> parent verification
```

Before launching the worker, establish:

- requirements and non-goals
- validation contract
- relevant plan or context paths
- files/areas likely involved
- escalation rules for unapproved decisions

Set `acceptance` on the worker for goal-style, broad, risky, or spec-driven work. Put implementation instructions in `task`; put done criteria in `acceptance.criteria`, proof in `acceptance.evidence`, runnable checks in `acceptance.verify`, and constraints in `acceptance.stopRules`.

After the first worker completes, treat its output as a handoff to review. Run fresh-context reviewers or validators unless the user explicitly asked for worker-only output or review-only output.

## Review Loop

Use when the user asks for a review/fix loop, "until clean", or a capped review cycle.

Rules:

- Default max 3 review rounds unless the user sets another cap.
- Count a review round each time fresh-context reviewers inspect the current diff after a worker pass.
- Stop when reviewers find no blockers or fixes worth doing now, remaining feedback is optional/deferred, an unapproved decision is needed, or the cap is reached.
- Do not loop for optional polish or speculative improvements.

Cycle:

```text
worker (if implementation requested) -> fresh reviewers -> parent synthesis -> fix worker for accepted fixes -> focused review if material changes
```

Reviewer fanout usually has three angles:

- correctness/regressions
- tests/validation
- simplicity/maintainability

Add security, performance, docs/API, domain, or user-flow validators only when the change calls for them.

## Staged Fix Orchestration

Use when a broad diff already has known findings across issue clusters and the user wants the parent to coordinate subagents.

Safe pattern:

1. Parallel read-only planning fanout. One planner/reviewer per issue cluster. Each child inspects the actual diff and returns exact files, line refs, proposed fix, and focused validation. No source edits.
2. One writer worker applies only accepted fixes in the active worktree. The worker receives the planning summaries, accepted scope, stop rules, and validation contract.
3. Parallel read-only validators inspect the resulting diff and report pass/fail, remaining blockers, and missing verification.

Prefer `async: true`, `context: "fresh"`, distinct `output` paths, and `outputMode: "file-only"` for large planning artifacts. Use named outputs (`as`) when later chain steps need exact prior outputs.

Do not launch several writer workers into the same dirty worktree. Use `worktree: true` only when intentionally isolating parallel writers.

## Parallel Research

Use when a question needs both external evidence and local implications.

Typical fanout:

- `researcher`: official docs, specs, primary sources, recent changes, ecosystem behavior, benchmarks.
- `scout` or `context-builder`: local files, architecture, constraints, tests, integration points.
- Optional strategy pass: compare external evidence to local architecture and identify tradeoffs.

Ask children for source links or file ranges, confidence, gaps, and decision implications. Do not ask them to edit unless implementation is explicitly requested.

Prompt shortcut: read `../../../prompts/parallel-research.md` when exact slash-command behavior matters.

## Parallel Context Build

Use before implementation planning when a stronger handoff is needed.

Run a chain whose first step is a parallel group of `context-builder` agents with distinct outputs, followed by a synthesis `context-builder` step. Typical outputs:

- `context-build/request-and-scope.md`
- `context-build/codebase-and-patterns.md`
- `context-build/validation-and-risks.md`
- synthesis handoff with a compact `meta-prompt`

Use `as` names and `{outputs.name}` for targeted synthesis. Use `{previous}` only when the synthesis needs the whole fan-in summary.

Prompt shortcut: `../../../prompts/parallel-context-build.md`.

## Parallel Handoff Plan

Use when the user wants an implementation-ready handoff from external references plus local code context.

First parallel group usually includes:

- `researcher` for external projects/docs/prompt guidance
- `context-builder` for local codebase context
- optional `context-builder` for implementation strategy if the scope is large

Second step: synthesis `context-builder` writes a final handoff plan with recommended approach, likely files, constraints, non-goals, validation, risks, unresolved questions, and a compact worker meta-prompt.

Prompt shortcut: `../../../prompts/parallel-handoff-plan.md`.

## Gather Context and Clarify

Use at the start of non-trivial work when local or external context can reduce wrong questions.

- Launch `scout` for local context.
- Add `researcher` only when external docs, current sources, or ecosystem behavior materially affect the decision.
- Synthesize known facts, assumptions, and remaining high-impact questions.
- Ask the user only questions that materially change scope, acceptance, constraints, or tradeoffs.

Prompt shortcut: `../../../prompts/gather-context-and-clarify.md`.

## Parallel Cleanup

Use after implementation when the user wants a cleanup pass or AI-slop reduction.

Launch two fresh-context `reviewer` tasks:

- deslop/unnecessary-complexity pass
- verbosity/readability pass

If `deslop` or `verbosity-cleaner` skills are available, pass the relevant skill to each reviewer. Otherwise inline the criteria. Both children should be review-only and return concrete issues with file/line evidence and smallest safe fixes.

Phrase constraints as: "Do not modify project/source files; returning findings through the configured output artifact is allowed." Parent decides what to apply unless cleanup/autofix is already authorized.

Prompt shortcut: `../../../prompts/parallel-cleanup.md`.

## Saved Chains

Use saved `.chain.md` or `.chain.json` workflows when the user wants repeatable multi-agent flow without rewriting chain logic each time. Prefer `.chain.json` for dynamic fanout or inline `outputSchema`; `.chain.md` is for simple sequential/static authoring.
