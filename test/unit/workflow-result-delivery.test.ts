import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { installResultDelivery } from "../../src/workflow-engine/register.ts";
import type { WorkflowManager } from "../../src/workflow-engine/workflow-manager.ts";

function fakeManager(runs: Record<string, { background: boolean }>): WorkflowManager {
	const m = new EventEmitter();
	(m as unknown as { getRun: (id: string) => unknown }).getRun = (id: string) => runs[id];
	return m as unknown as WorkflowManager;
}

function fakePi(calls: { msg: { content: string }; opts?: { triggerTurn?: boolean } }[]) {
	return {
		sendMessage: (msg: { content: string }, opts?: { triggerTurn?: boolean }) => {
			calls.push({ msg, opts });
		},
	} as never;
}

const RESULT = {
	meta: { name: "demo", description: "d" },
	result: { red: "RED", blue: "BLUE" },
	logs: [],
	phases: [],
	agentCount: 2,
	durationMs: 5,
};

describe("workflow background result delivery", () => {
	it("delivers a completed BACKGROUND run's result back into the conversation", () => {
		const calls: { msg: { content: string }; opts?: { triggerTurn?: boolean } }[] = [];
		const m = fakeManager({ r1: { background: true } });
		installResultDelivery(fakePi(calls), m);
		(m as unknown as EventEmitter).emit("complete", { runId: "r1", result: RESULT });
		assert.equal(calls.length, 1, "background completion must deliver one message");
		assert.equal(calls[0]!.opts?.triggerTurn, true, "delivery must trigger a turn so the model sees it");
		assert.match(calls[0]!.msg.content, /RED/);
		assert.match(calls[0]!.msg.content, /demo/);
	});

	it("does NOT re-deliver a FOREGROUND run (already returned inline as the tool result)", () => {
		const calls: { msg: { content: string }; opts?: { triggerTurn?: boolean } }[] = [];
		const m = fakeManager({ r2: { background: false } });
		installResultDelivery(fakePi(calls), m);
		(m as unknown as EventEmitter).emit("complete", { runId: "r2", result: RESULT });
		assert.equal(calls.length, 0, "foreground runs must not be re-delivered");
	});

	it("delivers each background run at most once (dedupe across duplicate complete events)", () => {
		const calls: { msg: { content: string }; opts?: { triggerTurn?: boolean } }[] = [];
		const m = fakeManager({ r3: { background: true } });
		installResultDelivery(fakePi(calls), m);
		(m as unknown as EventEmitter).emit("complete", { runId: "r3", result: RESULT });
		(m as unknown as EventEmitter).emit("complete", { runId: "r3", result: RESULT });
		assert.equal(calls.length, 1, "a run must be delivered at most once");
	});
});
