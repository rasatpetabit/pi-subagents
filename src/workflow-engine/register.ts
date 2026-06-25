/**
 * Registers the vendored, agent-dispatch-governed `workflow` tool onto this
 * fork's extension, as a sibling to `subagent`. Wiring mirrors the upstream
 * `extensions/workflow.ts` but installs ONLY the tool (not the slash-command /
 * editor / task-panel surface, which this fork covers elsewhere). Governance is
 * enforced inside the engine at the model-resolution seam — see
 * `workflow-engine/governance.ts` and `agent.ts`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildContextModeRegistry } from "./context-mode.ts";
import { WorkflowManager } from "./workflow-manager.ts";
import { createWorkflowStorage } from "./workflow-saved.ts";
import { loadWorkflowSettings } from "./workflow-settings.ts";
import { createWorkflowTool } from "./workflow-tool.ts";

/** Set to "1" to keep the workflow tool out of the active set unless opted in. */
const DISABLE_ENV = "PI_SUBAGENT_DISABLE_WORKFLOW";

export function registerWorkflowTool(pi: ExtensionAPI): void {
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
