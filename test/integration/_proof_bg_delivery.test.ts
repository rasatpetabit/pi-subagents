/**
 * LIVE PROOF (throwaway) — proves Part B end-to-end MINUS the Pi TUI: a REAL
 * background workflow run (real glm-5.2 served pass-through agent) reaches real
 * completion, and `installResultDelivery`'s manager "complete" listener delivers
 * the result via a captured `sendMessage({...}, { triggerTurn: true })`.
 *
 * What this does NOT cover (irreducibly interactive): whether the delivered
 * message renders + triggers a model turn inside a live Pi TUI session.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowManager } from "../../src/workflow-engine/workflow-manager.ts";
import { createWorkflowStorage } from "../../src/workflow-engine/workflow-saved.ts";
import { loadWorkflowSettings } from "../../src/workflow-engine/workflow-settings.ts";
import { buildContextModeRegistry } from "../../src/workflow-engine/context-mode.ts";
import { installResultDelivery } from "../../src/workflow-engine/register.ts";

function backendAvailable(): boolean {
	try {
		execFileSync("agent-dispatch", ["--help"], { stdio: "ignore", timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}
const HAVE_BACKEND = backendAvailable();

describe("LIVE PROOF: background workflow result delivery (real run)", () => {
	it(
		"a completed background run delivers its result via sendMessage(triggerTurn:true)",
		{ skip: HAVE_BACKEND ? false : "agent-dispatch CLI not on PATH", timeout: 300_000 },
		async () => {
			const cwd = mkdtempSync(join(tmpdir(), "wf-bg-proof-"));
			const settings = loadWorkflowSettings({ cwd });
			const storage = createWorkflowStorage(cwd);
			const manager = new WorkflowManager({
				cwd,
				loadSavedWorkflow: (n) => storage.load(n)?.script,
				defaultAgentTimeoutMs: 120_000,
				defaultWorkflowTimeoutMs: 240_000,
				concurrency: settings.defaultConcurrency,
				defaultAgentRetries: 0,
				contextModeRegistry: buildContextModeRegistry(settings.contextModes),
			});
			manager.on("error", () => {});
			manager.setMainModel("litellm/glm-5.2");

			const delivered: { msg: { content: string }; opts?: { triggerTurn?: boolean } }[] = [];
			const fakePi = {
				sendMessage: (msg: { content: string }, opts?: { triggerTurn?: boolean }) => {
					delivered.push({ msg, opts });
				},
			} as never;
			installResultDelivery(fakePi, manager);

			const script = `
export const meta = { name: 'bg-proof', description: 'live background delivery proof' };
const r = await agent('Reply with exactly this token and nothing else: PROOF_BG_OK', { model: 'glm-5.2' });
return r;
`;
			const { promise } = manager.startInBackground(script, undefined, {});
			await promise;
			// Flush the "complete" listener microtask before asserting.
			await new Promise((r) => setImmediate(r));

			console.log(`\n==== BG DELIVERY PROOF ====`);
			console.log(`sendMessage calls: ${delivered.length}`);
			console.log(`triggerTurn: ${delivered[0]?.opts?.triggerTurn}`);
			console.log(`content has token: ${delivered[0]?.msg.content.includes("PROOF_BG_OK")}`);
			console.log(`===========================\n`);

			assert.equal(delivered.length, 1, "background completion must deliver exactly one message");
			assert.equal(delivered[0]!.opts?.triggerTurn, true, "delivery must trigger a turn");
			assert.ok(
				delivered[0]!.msg.content.includes("PROOF_BG_OK"),
				`delivered content must carry the result token; got: ${delivered[0]!.msg.content.slice(0, 200)}`,
			);

			rmSync(cwd, { recursive: true, force: true });
		},
	);
});
