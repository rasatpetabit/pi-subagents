/**
 * WorkflowProgressAdapter — re-reads the authoritative WorkflowManager snapshot
 * on each event and projects workflow runs into the shared asyncJobs model
 * (AsyncJobState + AsyncJobStep) alongside subagent jobs.
 *
 * This adapter lives OUTSIDE the vendored src/workflow-engine/ directory and is
 * wired into registerWorkflowTool (src/workflow-engine/register.ts). It never
 * throws into the host — all event handlers are wrapped in try/catch to mirror
 * the installResultDelivery discipline.
 *
 * Key design choices (per spec):
 *   - Snapshot is source of truth; events are refresh triggers only (H3).
 *   - Initial sync on attach via listRuns() (H-new-1).
 *   - Per-run cleanup on terminal event; manager-listener detach only on
 *     shutdown (H-new-2).
 *   - Workflow job IDs are namespaced (`workflow:${runId}`) so they can never
 *     collide with subagent job IDs (adversary suggestion #2).
 *   - Each event handler extracts runId from the payload and projects that
 *     specific run — no coalesced re-scan is needed.
 */

import type { WorkflowManager } from "../workflow-engine/workflow-manager.ts";
import type { WorkflowAgentSnapshot } from "../workflow-engine/display.ts";
import type { AsyncJobState, AsyncJobStep, SubagentState } from "../shared/types.ts";

type Listener = (...args: unknown[]) => void;

export class WorkflowProgressAdapter {
  private readonly manager: WorkflowManager;
  private readonly asyncJobs: Map<string, AsyncJobState>;
  private readonly state: SubagentState;

  /** runId → the namespaced asyncJob key (`workflow:${runId}`). */
  private runJobs = new Map<string, string>();

  private attached = false;
  private listeners = new Map<string, Listener>();

  constructor(manager: WorkflowManager, state: SubagentState) {
    this.manager = manager;
    this.state = state;
    this.asyncJobs = state.asyncJobs;
  }

  /**
   * Attach to the manager's event bus. Idempotent — a second call is a no-op.
   * Performs an initial sync over already-active runs (via listRuns()) so a run
   * that is already past `agentStart` is visible immediately without waiting for
   * another event (H-new-1).
   */
  attach(): void {
    try {
      if (this.attached) return;
      this.attached = true;

      // Wire all event handlers. Every event extracts runId from its payload
      // and projects that specific run from the authoritative snapshot (H3).
      const eventTypes: string[] = [
        "agentStart",
        "agentEnd",
        "phase",
        "tokenUsage",
        "complete",
        "error",
      ];
      for (const type of eventTypes) {
        const listener = this.onEvent;
        this.manager.on(type, listener);
        this.listeners.set(type, listener);
      }

      // Initial sync: enumerate already-active runs via listRuns() and project
      // each from its current snapshot — so a run already past agentStart is
      // visible immediately (H-new-1).
      for (const persisted of this.manager.listRuns()) {
        const run = this.manager.getRun(persisted.runId);
        if (run) {
          this.projectRun(persisted.runId);
        }
      }
    } catch {
      // Never throw into the host (CD-7)
    }
  }

  /**
   * Detach ALL listeners from the manager. Used only on session shutdown
   * (or when no active runs remain AND no further runs can occur). Completing
   * one run must NOT detach the shared manager listeners — that would blind
   * concurrent runs (H-new-2).
   */
  detach(): void {
    try {
      for (const [type, listener] of this.listeners) {
        this.manager.removeListener(type, listener);
      }
      this.listeners.clear();
      this.attached = false;
    } catch {
      // Never throw
    }
  }

  /**
   * Single event handler for all event types. Extracts the `runId` from the
   * event payload and projects that run from the authoritative snapshot.
   * Terminal events (`complete`/`error`) also finalize the run's projection.
   */
  private onEvent = (...args: unknown[]): void => {
    try {
      const payload = args[0] ?? {};
      const runId = (payload as { runId?: string }).runId;
      if (runId) {
        this.projectRun(runId);
      }
    } catch {
      // Never throw into the host
    }
  };

  /**
   * Project one run's snapshot into the shared asyncJobs map.
   * Reads the in-memory ManagedRun snapshot (the authoritative state).
   * The job key is namespaced (`workflow:${runId}`) so it can never collide
   * with a subagent job's key (adversary #2).
   */
  projectRun(runId: string): void {
    const run = this.manager.getRun(runId);
    if (!run) return;

    const jobAsyncId = `workflow:${runId}`;
    this.runJobs.set(runId, jobAsyncId);
    const snapshot = run.snapshot;

    // Derive job status from snapshot.
    const hasRunning = snapshot.runningCount > 0;
    const hasError = snapshot.errorCount > 0;
    const jobStatus: AsyncJobState["status"] = hasError
      ? "failed"
      : hasRunning
        ? "running"
        : snapshot.doneCount > 0
          ? "complete"
          : "running";

    // Project each agent into a step.
    const steps: AsyncJobStep[] = snapshot.agents.map((agent, idx) => {
      const step: AsyncJobStep = {
        index: agent.id,
        status: agent.status,
        agent: agent.label,
        task: agent.prompt?.slice(0, 200),
        role: agent.agentType ?? agent.label,
        model: agent.model,
        tier: agent.tier,
        reasoning: undefined,
        tokens: agent.tokens,
        durationMs: computeElapsed(agent.startedAt, agent.endedAt),
      };
      return step;
    });

    // Determine when the run started (first agent's startedAt).
    const firstStartedAt = snapshot.agents.length > 0
      ? snapshot.agents[0].startedAt
        ? typeof snapshot.agents[0].startedAt === "string"
          ? new Date(snapshot.agents[0].startedAt).getTime()
          : (snapshot.agents[0].startedAt as number)
        : undefined
      : undefined;

    // Build or update the job entry in the shared asyncJobs map.
    const job: AsyncJobState = {
      asyncId: jobAsyncId,
      asyncDir: "",
      status: jobStatus,
      agents: snapshot.name ? [snapshot.name] : undefined,
      mode: "workflow",
      steps,
      stepsTotal: snapshot.agentCount,
      runningSteps: snapshot.runningCount,
      completedSteps: snapshot.doneCount,
      startedAt: firstStartedAt,
      updatedAt: Date.now(),
    };

    this.asyncJobs.set(jobAsyncId, job);
  }
}

/**
 * Compute elapsed time from startedAt (ISO string) to endedAt (ISO string or
 * undefined → now). Returns ms.
 */
function computeElapsed(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt) return undefined;
  const start =
    typeof startedAt === "string" ? new Date(startedAt).getTime() : (startedAt as number);
  const end =
    endedAt ? (typeof endedAt === "string" ? new Date(endedAt).getTime() : (endedAt as number)) : Date.now();
  return end - start;
}
