import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWorkflow } from "../../src/workflow-engine/workflow.ts";
import type { WorkflowAgent } from "../../src/workflow-engine/agent.ts";

/**
 * A stub agent runner that mimics the real WorkflowAgent.run() reasoning-resolution
 * seam: when the model spec carries a `:level` suffix, it fires `onReasoning` with
 * that level (exactly as the real runner does via resolveEffectiveThinking). This
 * lets us prove the workflow engine threads reasoning from the runner → onAgentEnd
 * event → (in the manager) the snapshot, without spawning a real LLM session.
 */
function stubAgent(extractLevel: (model: string | undefined) => string | undefined): Pick<WorkflowAgent, "run"> {
	return {
		async run(_prompt: string, options: any): Promise<unknown> {
			const level = extractLevel(options.model);
			options.onModelResolved?.(options.model ?? "litellm/test");
			if (level) options.onReasoning?.(level);
			options.onUsage?.({ input: 1, output: 2, total: 3, cacheRead: 0, cacheWrite: 0, cost: 0 });
			return "ok";
		},
	};
}

const SCRIPT = (model: string) =>
	`export const meta = { name: 'reasoning-flow', description: 'd', phases: [{ title: 'P' }] };\n` +
	`phase('P');\n` +
	`await agent('do work', { model: ${JSON.stringify(model)} });\n` +
	`return { done: true };\n`;

describe("workflow reasoning level flow", () => {
	it("threads the model :level suffix through onReasoning into onAgentEnd", async () => {
		let captured: { model?: string; reasoning?: string } = {};
		await runWorkflow(SCRIPT("litellm/opus-4.8:high"), {
			agent: stubAgent((m) => (m && m.includes(":high") ? "high" : undefined)),
			onAgentEnd: (e) => {
				captured = { model: e.model, reasoning: e.reasoning };
			},
		});
		assert.equal(captured.model, "litellm/opus-4.8:high");
		assert.equal(captured.reasoning, "high", "reasoning must flow from onReasoning → onAgentEnd");
	});

	it("leaves reasoning undefined when the model spec has no thinking suffix", async () => {
		let captured: { reasoning?: string } = {};
		await runWorkflow(SCRIPT("litellm/qwen-27b"), {
			agent: stubAgent((m) => (m && m.includes(":") ? m.slice(m.indexOf(":") + 1) : undefined)),
			onAgentEnd: (e) => {
				captured = { reasoning: e.reasoning };
			},
		});
		assert.equal(captured.reasoning, undefined, "no :level suffix → reasoning stays undefined → renders as dash");
	});

	it("populates reasoning for :low suffix too", async () => {
		let captured: { reasoning?: string } = {};
		await runWorkflow(SCRIPT("litellm/haiku-4.5:low"), {
			agent: stubAgent((m) => (m && m.includes(":") ? m.slice(m.indexOf(":") + 1) : undefined)),
			onAgentEnd: (e) => {
				captured = { reasoning: e.reasoning };
			},
		});
		assert.equal(captured.reasoning, "low");
	});
});