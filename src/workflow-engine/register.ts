/**
 * Registers the vendored, agent-dispatch-governed `workflow` tool onto this
 * fork's extension, as a sibling to `subagent`. Wiring mirrors the upstream
 * `extensions/workflow.ts` but installs a TRIMMED surface: the tool, a minimal
 * background-result delivery hook, and a `/workflows` status/stop command (the
 * upstream editor / live task-panel surface stays excluded — covered elsewhere).
 * Governance is enforced inside the engine at the model-resolution seam — see
 * `workflow-engine/governance.ts` and `agent.ts`.
 *
 * Result delivery matters because the tool defaults to FOREGROUND (inline) runs,
 * but an explicit `background: true` run detaches from the turn; without the
 * `installResultDelivery` hook its result would complete on disk and never reach
 * the conversation (the original "request a workflow, get nothing" failure for
 * backgrounded runs).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentState } from "../shared/types.ts";
import { buildContextModeRegistry } from "./context-mode.ts";
import type { WorkflowRunResult } from "./workflow.ts";
import { WorkflowManager } from "./workflow-manager.ts";
import { createWorkflowStorage } from "./workflow-saved.ts";
import { loadWorkflowSettings } from "./workflow-settings.ts";
import { createWorkflowTool } from "./workflow-tool.ts";
import { WorkflowProgressAdapter } from "../observability/workflow-progress-adapter.ts";

/** Set to "1" to keep the workflow tool out of the active set unless opted in. */
const DISABLE_ENV = "PI_SUBAGENT_DISABLE_WORKFLOW";

/** Custom message type for a delivered background-workflow result / command output. */
const WORKFLOW_RESULT_MESSAGE_TYPE = "workflow-result";
const WORKFLOW_COMMAND_MESSAGE_TYPE = "workflow-command";

/** Format a completed run's result as the message delivered back into the chat. */
function formatWorkflowResult(runId: string, result: WorkflowRunResult | undefined): string {
	const name = result?.meta?.name ?? "workflow";
	const agents = result?.agentCount ?? 0;
	const value = result?.result;
	const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return [
		`Workflow **${name}** (background run \`${runId}\`) completed with ${agents} agent(s).`,
		"",
		"## Result",
		"```json",
		body ?? "null",
		"```",
	].join("\n");
}

/**
 * Wire a listener that delivers a completed BACKGROUND run's result back into the
 * conversation via `sendMessage` (mirrors the fork's `runs/background/notify.ts`).
 * Foreground runs already return their result as the tool result, so they are
 * skipped to avoid duplicate delivery. Each run is delivered at most once.
 * Exported for unit testing; never throws into the host.
 */
export function installResultDelivery(pi: ExtensionAPI, manager: WorkflowManager): void {
	const delivered = new Set<string>();
	manager.on("complete", (payload: unknown) => {
		try {
			const { runId, result } = (payload ?? {}) as { runId?: string; result?: WorkflowRunResult };
			if (!runId || delivered.has(runId)) return;
			// Gate on `background`: getRun() only returns runs this session's manager
			// owns, and a foreground run already surfaced its result inline.
			const run = manager.getRun(runId);
			if (!run?.background) return;
			delivered.add(runId);
			pi.sendMessage(
				{
					customType: WORKFLOW_RESULT_MESSAGE_TYPE,
					content: formatWorkflowResult(runId, result),
					display: true,
					details: { runId },
				},
				{ triggerTurn: true },
			);
		} catch (error) {
			console.error(
				`[workflow] result delivery failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}

/** Register `/workflows status [id]` and `/workflows stop <id>` for background runs. */
export function installWorkflowCommands(pi: ExtensionAPI, manager: WorkflowManager): void {
	const say = (content: string) =>
		pi.sendMessage({ customType: WORKFLOW_COMMAND_MESSAGE_TYPE, content, display: true });
	pi.registerCommand("workflows", {
		description: "Inspect or stop background workflow runs: /workflows status [id] | /workflows stop <id>",
		handler: async (args: string) => {
			const [sub, id] = (args ?? "").trim().split(/\s+/, 2);
			if (sub === "stop") {
				if (!id) return say("Usage: `/workflows stop <id>`");
				return say(manager.stop(id) ? `Stopped workflow \`${id}\`.` : `No active run \`${id}\` in this session.`);
			}
			if (id) {
				const run = manager.getRun(id);
				return say(
					run
						? `\`${id}\`: ${run.status}${run.background ? " (background)" : ""}`
						: `No run \`${id}\` in this session.`,
				);
			}
			const runs = manager.listRuns();
			return say(
				runs.length === 0
					? "No workflow runs in this session."
					: ["### Workflow runs", ...runs.map((r) => `- \`${r.runId}\`: ${r.status}`)].join("\n"),
			);
		},
	});
}

export function registerWorkflowTool(pi: ExtensionAPI, state: SubagentState): void {
	if (process.env[DISABLE_ENV] === "1") return;

	const cwd = process.cwd();
	const storage = createWorkflowStorage(cwd);
	const settings = loadWorkflowSettings({ cwd });
	const contextModeRegistry = buildContextModeRegistry(settings.contextModes);
	const manager = new WorkflowManager({
		cwd,
		loadSavedWorkflow: (name) => storage.load(name)?.script,
		defaultAgentTimeoutMs: settings.defaultAgentTimeoutMs ?? null,
		defaultWorkflowTimeoutMs: settings.defaultWorkflowTimeoutMs,
		concurrency: settings.defaultConcurrency,
		defaultAgentRetries: settings.defaultAgentRetries,
		contextModeRegistry,
	});

	// The manager emits an "error" event on ANY workflow failure
	// (workflow-manager.ts). Node throws ERR_UNHANDLED_ERROR and crashes the host
	// process when "error" is emitted with no listener — so a single failing
	// workflow (e.g. a GovernanceDenied, an agent error, a timeout) would take down
	// the whole Pi session. The failure is ALSO surfaced through the tool's runSync
	// rejection (workflow-tool.ts), so this listener is purely the EventEmitter
	// safety net plus a log breadcrumb; keep it quiet.
	manager.on("error", (payload: unknown) => {
		const err = (payload as { error?: unknown })?.error ?? payload;
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[workflow] run error: ${msg}`);
	});

	const workflowTool = createWorkflowTool({ cwd, manager, storage });
	pi.registerTool(workflowTool);

	// Background-result delivery + `/workflows` command. Guarded independently so a
	// failure here can never prevent the (critical-path) tool registration above.
	try {
		installResultDelivery(pi, manager);
		installWorkflowCommands(pi, manager);
		// Wire the workflow-progress adapter (enhancement-ideas) — same independent guard
		// and never-throw discipline as installResultDelivery.
		const adapter = new WorkflowProgressAdapter(manager, state);
		adapter.attach();
	} catch (error) {
		console.warn(
			`[workflow] result delivery / commands not installed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		const active = pi.getActiveTools();
		if (!active.includes(workflowTool.name)) {
			pi.setActiveTools([...active, workflowTool.name]);
		}
		manager.setMainModel(ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
		try {
			manager.setSessionId(ctx.sessionManager?.getSessionId());
		} catch {
			// sessionManager may be unavailable in some contexts — fall back to global history.
		}
	});
}
