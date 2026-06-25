import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	dispositionKey,
	effectiveModelSpec,
	GovernanceDenied,
	governModelSpec,
	mapTierToClass,
	recordOutcome,
} from "../../src/workflow-engine/governance.ts";
import { isWorkflowError, WorkflowErrorCode, wrapError } from "../../src/workflow-engine/errors.ts";

/**
 * Proves the agent-dispatch governance seam on the vendored workflow engine:
 * the effective model is gated BEFORE any in-process spawn. We stub
 * `agent-dispatch` (via WORKFLOW_GUARD_CMD) so the test is hermetic.
 */

const PREV = process.env.WORKFLOW_GUARD_CMD;
let dir: string;
let stub: string;
let ledger: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "wf-gov-"));
	stub = join(dir, "agent-dispatch-stub.mjs");
	ledger = join(dir, "ledger.jsonl");
	// Stub: guard maps disposition keys to verdicts; record appends to a ledger
	// file and also drops a marker so the test can assert guard was/ wasn't called.
	writeFileSync(
		stub,
		`#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const [verb, , inputJson] = process.argv.slice(2);
const input = JSON.parse(inputJson);
if (verb === "guard") {
  appendFileSync(${JSON.stringify(join(dir, "guard-calls.log"))}, input.model + "\\n");
  // Mirrors the REAL agent-dispatch guard contract (probed 2026-06-24):
  //   haiku  -> deny ("haiku is forbidden; no override path exists")
  //   sonnet -> deny ("sonnet requires live override grant")
  //   opus/fable -> allow ("allowed-model")
  // The engine treats every non-"allow" verdict identically (throw), so the
  // exact deny/override_required spelling is immaterial to enforcement.
  const reasons = {
    haiku: "haiku is forbidden; no override path exists",
    sonnet: "sonnet requires live override grant",
  };
  const v = (input.model === "haiku" || input.model === "sonnet") ? "deny" : "allow";
  process.stdout.write(JSON.stringify({ verdict: v, reason: reasons[input.model] ?? "allowed-model" }));
  process.exit(0);
}
if (verb === "record") {
  appendFileSync(${JSON.stringify(ledger)}, inputJson + "\\n");
  process.stdout.write("{}");
  process.exit(0);
}
process.exit(3);
`,
	);
	chmodSync(stub, 0o755);
	process.env.WORKFLOW_GUARD_CMD = stub;
});

afterEach(() => {
	if (PREV === undefined) delete process.env.WORKFLOW_GUARD_CMD;
	else process.env.WORKFLOW_GUARD_CMD = PREV;
});

describe("governance: pure mappers", () => {
	it("maps disposition keys from specs", () => {
		assert.equal(dispositionKey("anthropic/claude-haiku-4-5"), "haiku");
		assert.equal(dispositionKey("anthropic/claude-sonnet-4-6"), "sonnet");
		assert.equal(dispositionKey("anthropic/claude-opus-4-8"), "opus");
		assert.equal(dispositionKey("claude-fable-5"), "fable");
		assert.equal(dispositionKey("glm-5.2"), null);
		assert.equal(dispositionKey("qwen36-27b"), null);
		assert.equal(dispositionKey(undefined), null);
	});

	it("maps tiers to agent-dispatch classes", () => {
		assert.equal(mapTierToClass("small"), "bounded-edit");
		assert.equal(mapTierToClass("review"), "cross-review");
		assert.equal(mapTierToClass("smart"), "architecture");
		assert.equal(mapTierToClass(undefined), "unknown");
	});
});

describe("governance: gate (enforcement before spawn)", () => {
	it("DENIES a forbidden model (haiku) — throws before any spawn", () => {
		assert.throws(
			() => governModelSpec({ effectiveSpec: "anthropic/claude-haiku-4-5", tier: "small" }),
			(e) => e instanceof GovernanceDenied && e.verdict === "deny" && e.model === "haiku",
		);
	});

	it("DENIES an override-only model (sonnet) without a grant", () => {
		// Real guard returns verdict "deny" (reason: requires live override grant)
		// rather than a distinct "override_required" — the engine rejects either way.
		assert.throws(
			() => governModelSpec({ effectiveSpec: "anthropic/claude-sonnet-4-6" }),
			(e) => e instanceof GovernanceDenied && e.verdict === "deny" && e.model === "sonnet",
		);
	});

	it("ALLOWS a permitted disposition (opus) and labels the class", () => {
		const r = governModelSpec({ effectiveSpec: "anthropic/claude-opus-4-8", tier: "smart" });
		assert.equal(r.guardedKey, "opus");
		assert.equal(r.taskClass, "architecture");
	});

	it("PASSES THROUGH served/local models without invoking the guard", () => {
		const r = governModelSpec({ effectiveSpec: "glm-5.2", tier: "medium" });
		assert.equal(r.guardedKey, null);
		assert.equal(r.taskClass, "investigation");
		// guard must not have been consulted for a non-disposition spec
		assert.ok(!existsSync(join(dir, "guard-calls.log")), "guard not called for served model");
	});

	it("FAILS CLOSED: a down guard rejects a disposition-keyed model", () => {
		process.env.WORKFLOW_GUARD_CMD = join(dir, "does-not-exist");
		assert.throws(
			() => governModelSpec({ effectiveSpec: "anthropic/claude-haiku-4-5" }),
			(e) => e instanceof GovernanceDenied && e.verdict === "guard_unavailable",
		);
	});
});

describe("governance: effective-model gating (P1/P2 bypass fixes)", () => {
	it("effectiveModelSpec mirrors spawn precedence: resolved > sessionOption > default", () => {
		assert.equal(
			effectiveModelSpec({
				resolvedSpec: "anthropic/claude-opus-4-8",
				sessionOptionSpec: "anthropic/claude-haiku-4-5",
				sessionDefault: "glm-5.2",
			}),
			"anthropic/claude-opus-4-8",
		);
		assert.equal(
			effectiveModelSpec({ sessionOptionSpec: "anthropic/claude-haiku-4-5", sessionDefault: "glm-5.2" }),
			"anthropic/claude-haiku-4-5",
		);
		assert.equal(effectiveModelSpec({ sessionDefault: "glm-5.2" }), "glm-5.2");
		assert.equal(effectiveModelSpec({ sessionDefault: null }), undefined);
		assert.equal(effectiveModelSpec({}), undefined);
	});

	it("P1: an inherited forbidden session default is DENIED (untagged agent, no resolved/option model)", () => {
		const spec = effectiveModelSpec({ sessionDefault: "anthropic/claude-haiku-4-5" });
		assert.throws(
			() => governModelSpec({ effectiveSpec: spec, tier: undefined }),
			(e) => e instanceof GovernanceDenied && e.model === "haiku",
		);
	});

	it("P2: a forbidden sessionOptions.model is DENIED even when no per-call model resolves", () => {
		const spec = effectiveModelSpec({
			sessionOptionSpec: "anthropic/claude-sonnet-4-6",
			sessionDefault: "glm-5.2",
		});
		assert.throws(
			() => governModelSpec({ effectiveSpec: spec, tier: undefined }),
			(e) => e instanceof GovernanceDenied && e.model === "sonnet",
		);
	});

	it("FAILS CLOSED on an undeterminable spawn model (no resolved/option/usable-default)", () => {
		const spec = effectiveModelSpec({}); // undefined
		assert.equal(spec, undefined);
		assert.throws(
			() => governModelSpec({ effectiveSpec: spec, tier: "medium" }),
			(e) => e instanceof GovernanceDenied && e.verdict === "undeterminable_model",
		);
		// must fail closed WITHOUT consulting the guard (nothing to ask about)
		assert.ok(!existsSync(join(dir, "guard-calls.log")), "guard not called for undeterminable spec");
	});

	it("a served/local session default still passes through (no false-deny)", () => {
		const spec = effectiveModelSpec({ sessionDefault: "glm-5.2" });
		const r = governModelSpec({ effectiveSpec: spec, tier: "medium" });
		assert.equal(r.guardedKey, null);
		assert.ok(!existsSync(join(dir, "guard-calls.log")), "guard not called for served default");
	});
});

describe("governance: denial is terminal (P3 — not swallowed into null)", () => {
	it("GovernanceDenied is a NON-recoverable WorkflowError with GOVERNANCE_DENIED code", () => {
		const e = new GovernanceDenied("denied", "haiku", "deny");
		assert.ok(isWorkflowError(e), "GovernanceDenied must be a WorkflowError");
		assert.equal(e.code, WorkflowErrorCode.GOVERNANCE_DENIED);
		assert.equal(e.recoverable, false);
		assert.equal(e.model, "haiku");
		assert.equal(e.verdict, "deny");
	});

	it("wrapError passes a denial through unchanged (so the runner aborts, not retries→null)", () => {
		const denied = new GovernanceDenied("denied", "sonnet", "deny");
		const wrapped = wrapError(denied, { agentLabel: "x" });
		assert.equal(wrapped, denied, "must be the same instance (wrapError short-circuits WorkflowError)");
		assert.equal(wrapped.recoverable, false, "non-recoverable → workflow.ts throws instead of returning null");
	});
});

describe("governance: ledger recording", () => {
	it("records an outcome row via agent-dispatch record", () => {
		recordOutcome({
			taskClass: "architecture",
			model: "anthropic/claude-opus-4-8",
			tokensIn: 100,
			tokensOut: 50,
			durationMs: 1234,
			outcome: "success",
		});
		const rows = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
		assert.equal(rows.length, 1);
		const row = JSON.parse(rows[0]);
		assert.equal(row.task_class, "architecture");
		assert.equal(row.backend, "workflow-engine");
		assert.equal(row.outcome, "success");
		assert.equal(row.tokens_in, 100);
	});

	it("is best-effort: a down ledger never throws", () => {
		process.env.WORKFLOW_GUARD_CMD = join(dir, "does-not-exist");
		assert.doesNotThrow(() =>
			recordOutcome({ taskClass: "unknown", model: null, outcome: "failure" }),
		);
	});
});
