import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkflowTool } from "../../src/workflow-engine/workflow-tool.ts";
import type { WorkflowManager } from "../../src/workflow-engine/workflow-manager.ts";

// A minimal stub manager that records which execution path the tool took. The
// tool's sync path calls `runSync`; its background path calls `startInBackground`.
function stubManager(calls: { runSync: number; background: number }): WorkflowManager {
	return {
		hasTaskPanel: false,
		startInBackground() {
			calls.background++;
			return { runId: "bg-run", promise: Promise.resolve(undefined) };
		},
		getRun() {
			return undefined;
		},
		async runSync() {
			calls.runSync++;
			return {
				meta: { name: "t", description: "d" },
				result: "INLINE_RESULT",
				logs: [],
				phases: [],
				agentCount: 1,
				durationMs: 1,
			};
		},
	} as unknown as WorkflowManager;
}

const SCRIPT = "export const meta = { name: 't', description: 'd' };\nconst r = await agent('x');\nreturn r;";

describe("workflow tool default execution mode", () => {
	it("runs inline (foreground) by default and returns the result in the same turn", async () => {
		const calls = { runSync: 0, background: 0 };
		const tool = createWorkflowTool({ manager: stubManager(calls) });
		const res = (await tool.execute(
			"call-1",
			{ script: SCRIPT } as never,
			undefined as never,
			() => {},
			{ hasUI: false } as never,
		)) as { content: { text: string }[] };
		assert.equal(calls.runSync, 1, "default must block on runSync (inline)");
		assert.equal(calls.background, 0, "default must NOT route to startInBackground");
		assert.match(res.content[0]!.text, /INLINE_RESULT/);
	});

	it("still honors explicit background: true (opt-in)", async () => {
		const calls = { runSync: 0, background: 0 };
		const tool = createWorkflowTool({ manager: stubManager(calls) });
		const res = (await tool.execute(
			"call-2",
			{ script: SCRIPT, background: true } as never,
			undefined as never,
			() => {},
			{ hasUI: false } as never,
		)) as { content: { text: string }[] };
		assert.equal(calls.background, 1, "explicit background:true must route to startInBackground");
		assert.equal(calls.runSync, 0);
		assert.match(res.content[0]!.text, /background/i);
	});
});
