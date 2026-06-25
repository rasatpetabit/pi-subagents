/**
 * LIVE integration test for the agent-dispatch governance seam — exercises the
 * FULL path through the real workflow engine and the REAL `agent-dispatch guard`
 * subprocess (no stub):
 *
 *   manager.runSync(script with agent({model: haiku}))
 *     → WorkflowAgent.run → governModelSpec → consultGuard → `agent-dispatch guard`
 *     → (exit 2 + {"verdict":"deny"}) → GovernanceDenied(non-recoverable) → abort
 *
 * This pins two findings that the stubbed unit tests structurally could not catch:
 *  1. The real CLI exits NON-ZERO (code 2) on a deny while printing the verdict
 *     JSON; consultGuard must parse that (a clean "deny"), NOT mistake it for a
 *     guard-unavailable fail-closed.
 *  2. WorkflowManager emits an "error" event on failure; without a listener Node
 *     crashes the host. register.ts attaches one — mirror that here so the harness
 *     does not ERR_UNHANDLED_ERROR.
 *
 * Skips gracefully when the `agent-dispatch` CLI is not on PATH.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowManager } from "../../src/workflow-engine/workflow-manager.ts";
import { createWorkflowStorage } from "../../src/workflow-engine/workflow-saved.ts";
import { loadWorkflowSettings } from "../../src/workflow-engine/workflow-settings.ts";
import { buildContextModeRegistry } from "../../src/workflow-engine/context-mode.ts";

function guardAvailable(): boolean {
	try {
		execFileSync("agent-dispatch", ["--help"], { stdio: "ignore", timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}

const HAVE_GUARD = guardAvailable();

describe("LIVE governance: real agent-dispatch guard rejects a forbidden model", () => {
	let cwd: string;

	before(() => {
		cwd = mkdtempSync(join(tmpdir(), "wf-gov-live-"));
	});
	after(() => {
		try {
			rmSync(cwd, { recursive: true, force: true });
		} catch {
			// best-effort
		}
	});

	function buildManager(): WorkflowManager {
		const settings = loadWorkflowSettings({ cwd });
		const storage = createWorkflowStorage(cwd);
		const manager = new WorkflowManager({
			cwd,
			loadSavedWorkflow: (n) => storage.load(n)?.script,
			defaultAgentTimeoutMs: settings.defaultAgentTimeoutMs ?? null,
			defaultWorkflowTimeoutMs: settings.defaultWorkflowTimeoutMs,
			concurrency: settings.defaultConcurrency,
			defaultAgentRetries: settings.defaultAgentRetries,
			contextModeRegistry: buildContextModeRegistry(settings.contextModes),
		});
		// Mirror register.ts: prevent the EventEmitter "error" crash. Capture so the
		// test can assert the emitted payload too.
		manager.on("error", () => {});
		manager.setMainModel("litellm/glm-5.2");
		return manager;
	}

	it(
		"a workflow forcing anthropic/claude-haiku-4-5 aborts with a clean GOVERNANCE_DENIED/deny (not fail-closed)",
		{ skip: HAVE_GUARD ? false : "agent-dispatch CLI not on PATH" },
		async () => {
			const manager = buildManager();
			const script = `
export const meta = { name: 'gov-live', description: 'forbidden model rejected before spawn' };
const r = await agent('say hi in one word', { model: 'anthropic/claude-haiku-4-5' });
return r;
`;
			let caught: any;
			try {
				await manager.runSync(script, undefined, {});
			} catch (e) {
				caught = (e as { error?: unknown })?.error ?? e;
			}
			assert.ok(caught, "workflow must reject (forbidden model)");
			assert.equal(caught.name, "GovernanceDenied");
			assert.equal(caught.code, "GOVERNANCE_DENIED");
			// The crux: a real deny (CLI exit 2 + verdict JSON) is parsed as "deny",
			// NOT swallowed into a guard_unavailable fail-closed.
			assert.equal(caught.verdict, "deny");
			assert.equal(caught.recoverable, false);
			assert.match(caught.message, /haiku/i);
		},
	);
});
