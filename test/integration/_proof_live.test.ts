/**
 * LIVE PROOF (throwaway) — demonstrates the governed workflow engine end-to-end
 * against the REAL agent-dispatch guard AND a REAL model backend (litellm gateway).
 *
 * Three cases, each a real `manager.runSync` of a real workflow:
 *   1. glm-5.2   — served/local → gate PASSES THROUGH (guard NOT consulted) → real
 *                  subagent spawns via createAgentSession → returns correct output.
 *   2. fable-5   — Anthropic disposition (allowed) → guard IS consulted → ALLOW →
 *                  real subagent spawns → returns correct output.
 *   3. haiku-4.5 — Anthropic disposition (FORBIDDEN) → guard IS consulted → DENY →
 *                  GovernanceDenied thrown BEFORE any spawn.
 *
 * A guard wrapper records every guard invocation so we can PROVE the guard was
 * consulted for 1/2/3 exactly as designed (not at all for glm; with allow for
 * fable; with deny for haiku). record calls are redirected to a temp ledger.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

describe("LIVE PROOF: governed workflow engine, real guard + real backend", () => {
	let dir: string;
	let guardLog: string;
	let recLedger: string;
	const prevGuardCmd = process.env.WORKFLOW_GUARD_CMD;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), "wf-proof-"));
		guardLog = join(dir, "guard-calls.log");
		recLedger = join(dir, "rec-ledger.jsonl");
		const wrapper = join(dir, "guard-wrapper.sh");
		// Logs the guard --input payload, redirects record to a temp ledger, then
		// delegates to the REAL agent-dispatch on PATH.
		writeFileSync(
			wrapper,
			`#!/usr/bin/env bash
if [ "$1" = "guard" ]; then printf '%s\\n' "$3" >> ${JSON.stringify(guardLog)}; exec agent-dispatch "$@"; fi
if [ "$1" = "record" ]; then exec agent-dispatch "$@" --ledger ${JSON.stringify(recLedger)}; fi
exec agent-dispatch "$@"
`,
		);
		chmodSync(wrapper, 0o755);
		process.env.WORKFLOW_GUARD_CMD = wrapper;
	});
	after(() => {
		if (prevGuardCmd === undefined) delete process.env.WORKFLOW_GUARD_CMD;
		else process.env.WORKFLOW_GUARD_CMD = prevGuardCmd;
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* best-effort */
		}
	});

	function buildManager(cwd: string): WorkflowManager {
		const settings = loadWorkflowSettings({ cwd });
		const storage = createWorkflowStorage(cwd);
		const manager = new WorkflowManager({
			cwd,
			loadSavedWorkflow: (n) => storage.load(n)?.script,
			defaultAgentTimeoutMs: 120_000,
			defaultWorkflowTimeoutMs: 180_000,
			concurrency: settings.defaultConcurrency,
			defaultAgentRetries: 0,
			contextModeRegistry: buildContextModeRegistry(settings.contextModes),
		});
		manager.on("error", () => {});
		manager.setMainModel("litellm/glm-5.2");
		return manager;
	}

	function guardCallsFor(substr: string): string[] {
		if (!existsSync(guardLog)) return [];
		return readFileSync(guardLog, "utf8")
			.trim()
			.split("\n")
			.filter((l) => l.includes(substr));
	}

	async function runCase(model: string, token: string): Promise<{ ok: boolean; text: string; err?: any }> {
		const cwd = mkdtempSync(join(tmpdir(), "wf-proof-run-"));
		const manager = buildManager(cwd);
		const script = `
export const meta = { name: 'proof', description: 'live proof' };
const r = await agent('Reply with exactly this token and nothing else: ${token}', { model: ${JSON.stringify(model)} });
return r;
`;
		try {
			const res = await manager.runSync(script, undefined, {});
			return { ok: true, text: JSON.stringify(res) };
		} catch (e) {
			return { ok: false, text: "", err: (e as { error?: unknown })?.error ?? e };
		} finally {
			try {
				rmSync(cwd, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
		}
	}

	it(
		"runs the full positive + negative matrix against the real guard and gateway",
		{ skip: HAVE_GUARD ? false : "agent-dispatch CLI not on PATH", timeout: 300_000 },
		async () => {
			// CASE 1: served pass-through → real spawn → correct output
			const glm = await runCase("glm-5.2", "PROOF_GLM_OK");
			// CASE 2: allowed disposition → guard allow → real spawn → correct output
			const fable = await runCase("opus-4.8", "PROOF_OPUS_OK");
			// CASE 3: forbidden disposition → guard deny → NO spawn
			const haiku = await runCase("haiku-4.5", "PROOF_HAIKU_OK");

			const glmGuard = guardCallsFor("glm");
			const fableGuard = guardCallsFor("opus");
			const haikuGuard = guardCallsFor("haiku");

			// ---- PROOF MATRIX (printed) ----
			console.log("\n================ LIVE PROOF MATRIX ================");
			console.log(
				`1) glm-5.2  (served)    : run.ok=${glm.ok}  guardConsulted=${glmGuard.length > 0}  output=${glm.ok ? (glm.text.includes("PROOF_GLM_OK") ? "PROOF_GLM_OK✓" : glm.text.slice(0, 60)) : "—"}`,
			);
			console.log(
				`2) opus-4.8 (disp:allow): run.ok=${fable.ok}  guardConsulted=${fableGuard.length > 0}  output=${fable.ok ? (fable.text.includes("PROOF_OPUS_OK") ? "PROOF_OPUS_OK✓" : fable.text.slice(0, 60)) : "—"}`,
			);
			console.log(
				`3) haiku-4.5(disp:DENY) : run.ok=${haiku.ok}  guardConsulted=${haikuGuard.length > 0}  denied=${haiku.err?.name === "GovernanceDenied"}  verdict=${haiku.err?.verdict}`,
			);
			console.log("==================================================\n");

			// ---- ASSERTIONS ----
			// 1. Served model: ran, produced the exact token, guard NOT consulted.
			assert.equal(glm.ok, true, "glm workflow must complete");
			assert.ok(glm.text.includes("PROOF_GLM_OK"), `glm output must contain token; got ${glm.text.slice(0, 200)}`);
			assert.equal(glmGuard.length, 0, "served model must NOT consult the guard (pass-through)");

			// 2. Allowed disposition: guard consulted (allow), ran, produced the token.
			assert.equal(fable.ok, true, "fable workflow must complete");
			assert.ok(fable.text.includes("PROOF_OPUS_OK"), `fable output must contain token; got ${fable.text.slice(0, 200)}`);
			assert.ok(fableGuard.length > 0, "allowed disposition MUST consult the guard");

			// 3. Forbidden disposition: guard consulted (deny), GovernanceDenied, no run.
			assert.equal(haiku.ok, false, "haiku workflow must be rejected");
			assert.equal(haiku.err?.name, "GovernanceDenied");
			assert.equal(haiku.err?.verdict, "deny");
			assert.ok(haikuGuard.length > 0, "forbidden disposition MUST consult the guard");
		},
	);
});
