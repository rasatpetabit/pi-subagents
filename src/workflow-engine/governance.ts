/**
 * GOVERNANCE — agent-dispatch enforcement seam for the vendored workflow engine.
 *
 * The upstream engine spawns subagents IN-PROCESS via `createAgentSession`,
 * resolving models against the local Pi ModelRegistry. That path bypasses the
 * agent-dispatch PreToolUse guard entirely. Rather than route execution through
 * the dispatch subprocess (which would forfeit the engine's in-process journaled
 * resume + `getSessionStats` cost accounting), we gate the *effective model* at
 * the single resolution point with a standalone `agent-dispatch guard` check,
 * then spawn in-process as before.
 *
 * What this enforces (the binding rules — see `agent-dispatch digest`):
 *   - haiku  → FORBIDDEN  → spawn rejected before it happens.
 *   - sonnet → OVERRIDE-ONLY → rejected unless a live grant makes guard allow it.
 *   - opus/fable and any other disposition-keyed Anthropic spec → guarded.
 *
 * Deliberately NOT guarded: served/local gateway models (e.g. glm-5.2,
 * qwen36-27b, nemotron-*) whose raw names the guard reports as "unsupported"
 * (it keys on disposition + route aliases, not served names). Guarding those
 * would false-deny legitimate routing. Disposition mapping below targets exactly
 * the models the binding rules govern. Routing tier requests onto specific
 * gateway-served models is a follow-up (needs the Pi ModelRegistry to carry the
 * gateway entries); this cut delivers the gate.
 *
 * Fail-closed: if the guard cannot be consulted for a disposition-keyed (i.e.
 * potentially forbidden) model, the spawn is REJECTED — a down guard must never
 * silently admit a haiku/sonnet request.
 */

import { execFileSync } from "node:child_process";
import { WorkflowError, WorkflowErrorCode } from "./errors.ts";

/** Command used to reach agent-dispatch. Read at call time so it is overridable
 * (env `WORKFLOW_GUARD_CMD`) for tests and alternate deployments. */
function guardCmd(): string {
  return process.env.WORKFLOW_GUARD_CMD ?? "agent-dispatch";
}

/**
 * A governance denial. Extends WorkflowError with a NON-recoverable
 * GOVERNANCE_DENIED code so the workflow runner aborts hard instead of mapping
 * it (via `wrapError`) to a recoverable AGENT_EXECUTION_ERROR that retries into a
 * silent `null` (see errors.ts `wrapError`, workflow.ts retry loop). `instanceof
 * GovernanceDenied` and the `.model`/`.verdict` fields are preserved for callers
 * and tests.
 */
export class GovernanceDenied extends WorkflowError {
  readonly verdict: string;
  readonly model: string;
  constructor(message: string, model: string, verdict: string) {
    super(message, WorkflowErrorCode.GOVERNANCE_DENIED, {
      recoverable: false,
      details: { model, verdict },
    });
    this.name = "GovernanceDenied";
    this.model = model;
    this.verdict = verdict;
  }
}

/**
 * Map an engine model spec (`provider/modelId` or bare id) to the agent-dispatch
 * HARD-RULE disposition key the guard understands, or null when the spec is not
 * one of the governed dispositions (served/local models — passed through).
 */
export function dispositionKey(spec: string | undefined): string | null {
  if (!spec) return null;
  const s = spec.toLowerCase();
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  if (s.includes("fable")) return "fable";
  return null;
}

/**
 * Map a workflow tier label to an agent-dispatch task class (used for the guard
 * `task_class` and the outcome-ledger row). Conservative defaults; the exact map
 * is policy-tunable later.
 */
export function mapTierToClass(tier: string | undefined): string {
  switch ((tier ?? "").toLowerCase()) {
    case "small":
    case "cheap":
      return "bounded-edit";
    case "medium":
      return "investigation";
    case "large":
    case "smart":
    case "big":
      return "architecture";
    case "review":
      return "cross-review";
    default:
      return "unknown";
  }
}

interface GuardVerdict {
  verdict: "allow" | "deny" | "override_required" | string;
  reason?: string;
}

function consultGuard(model: string, taskClass: string): GuardVerdict {
  const input = JSON.stringify({ model, task_class: taskClass });
  const out = execFileSync(guardCmd(), ["guard", "--input", input], {
    encoding: "utf8",
    timeout: 10_000,
    // guard prints its JSON verdict on stdout and exits 0 even on deny.
  });
  return JSON.parse(out) as GuardVerdict;
}

/**
 * Compute the EFFECTIVE model spec that `createAgentSession` will actually spawn,
 * matching the spawn-option precedence exactly: the per-call resolved model wins
 * (it is spread last in agent.ts), else an explicit `sessionOptions.model`, else
 * the session default the SDK inherits from `settingsManager.getDefaultModel()`.
 * The gate MUST be applied to this value, not merely to the requested spec —
 * otherwise an inherited forbidden default or a forbidden `sessionOptions.model`
 * reaches the spawn ungated.
 */
export function effectiveModelSpec(args: {
  resolvedSpec?: string;
  sessionOptionSpec?: string;
  sessionDefault?: string | null;
}): string | undefined {
  return args.resolvedSpec ?? args.sessionOptionSpec ?? args.sessionDefault ?? undefined;
}

export interface GovernResult {
  /** agent-dispatch task class for this agent run (for the outcome ledger). */
  taskClass: string;
  /** Disposition key that was guarded, or null when the spec was passed through. */
  guardedKey: string | null;
}

/**
 * Gate the effective model spec the engine is about to spawn. Throws
 * GovernanceDenied for a forbidden/override-required model, or for a guard
 * failure on a disposition-keyed (potentially forbidden) model (fail-closed).
 * Returns the task-class label for ledger recording.
 */
export function governModelSpec(args: {
  effectiveSpec: string | undefined;
  tier?: string;
}): GovernResult {
  const taskClass = mapTierToClass(args.tier);
  const spec = args.effectiveSpec?.trim();
  if (!spec) {
    // FAIL-CLOSED on an undeterminable spawn model. effectiveSpec is empty only
    // when there is no per-call model, no sessionOptions.model, AND no usable saved
    // default (both provider+id) — exactly the case where createAgentSession falls
    // back to the SDK's defaultModelPerProvider / availableModels[0], which this gate
    // cannot verify. Refusing here closes the narrow residual where that fallback
    // could be a forbidden disposition. (A configured default — e.g. litellm/glm-5.2
    // here — yields a concrete spec and never reaches this branch.)
    throw new GovernanceDenied(
      "agent-dispatch governance: effective spawn model is undeterminable (no per-call model, " +
        "sessionOptions.model, or usable saved default provider+id); refusing to spawn (fail-closed). " +
        "Set an explicit model/tier or a default model+provider.",
      "(undeterminable)",
      "undeterminable_model",
    );
  }
  const key = dispositionKey(spec);
  if (key === null) {
    // Not a governed disposition (served/local model) — pass through, label only.
    return { taskClass, guardedKey: null };
  }

  let verdict: GuardVerdict;
  try {
    verdict = consultGuard(key, taskClass);
  } catch (err) {
    // Fail-closed: a potentially-forbidden model must not slip through a down guard.
    throw new GovernanceDenied(
      `agent-dispatch guard unavailable for model "${key}" (fail-closed): ${
        err instanceof Error ? err.message : String(err)
      }`,
      key,
      "guard_unavailable",
    );
  }

  if (verdict.verdict !== "allow") {
    throw new GovernanceDenied(
      `model "${args.effectiveSpec}" denied by agent-dispatch (${verdict.verdict}): ${
        verdict.reason ?? "no reason given"
      }`,
      key,
      verdict.verdict,
    );
  }

  return { taskClass, guardedKey: key };
}

/**
 * Record one in-process agent spawn to the agent-dispatch outcome ledger via
 * `agent-dispatch record`. The dispatch path never brackets these in-process
 * spawns, so the engine reports them itself. Best-effort: a ledger failure must
 * never mask or fail the agent result.
 */
export function recordOutcome(args: {
  taskClass: string;
  model: string | null;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  outcome: "success" | "failure" | "timeout" | "interrupted";
}): void {
  const input = JSON.stringify({
    task_class: args.taskClass,
    backend: "workflow-engine",
    model: args.model,
    tokens_in: args.tokensIn,
    tokens_out: args.tokensOut,
    duration_ms: args.durationMs,
    outcome: args.outcome,
  });
  try {
    execFileSync(guardCmd(), ["record", "--input", input], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "ignore", "ignore"],
    });
  } catch {
    // Best-effort: never let ledger recording affect the run.
  }
}
