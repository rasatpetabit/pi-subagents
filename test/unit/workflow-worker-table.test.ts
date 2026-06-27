import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentMetaText, renderWorkflowWorkerTable, type WorkflowSnapshot } from "../../src/workflow-engine/display.ts";
import type { ThemeLike } from "../../src/modes/interactive/theme.ts";

const noTheme: ThemeLike = {
	fg: (_tone: string, text: string) => text,
} as unknown as ThemeLike;

function snapshot(agents: Partial<WorkflowSnapshot["agents"][number]>[]): WorkflowSnapshot {
	return {
		name: "demo",
		description: "d",
		agents: agents.map((a, i) => ({
			id: i + 1,
			label: a.label ?? `agent-${i + 1}`,
			phase: a.phase,
			status: a.status ?? "done",
			model: a.model,
			tier: a.tier,
			reasoning: a.reasoning,
			tokens: a.tokens,
			resultPreview: a.resultPreview,
			prompt: a.prompt,
			startedAt: a.startedAt,
		})) as WorkflowSnapshot["agents"],
		logs: [],
		phases: [],
		runningCount: 0,
		doneCount: agents.length,
		agentCount: agents.length,
		tokens: 0,
		durationMs: 0,
	} as WorkflowSnapshot;
}

describe("renderWorkflowWorkerTable", () => {
	it("renders every worker (no maxAgents truncation)", () => {
		const agents = Array.from({ length: 5 }, (_v, i) => ({ label: `w${i + 1}`, model: `litellm/qwen-${i}` }));
		const table = renderWorkflowWorkerTable(snapshot(agents));
		const dataRows = table.split("\n").slice(2); // drop header + separator
		assert.equal(dataRows.length, 5, "all 5 workers appear");
		assert.match(table, /qwen-4/);
	});

	it("shows model/tier/reasoning/tokens columns and dash fallbacks", () => {
		const table = renderWorkflowWorkerTable(
			snapshot([
				{ label: "explorer", model: "litellm/haiku-4.5", tier: "small", tokens: 123 },
				{ label: "blank-agent" },
			]),
		);
		assert.match(table, /haiku-4\.5/);
		assert.match(table, /small/);
		assert.match(table, /123/);
		// The blank agent must show dashes for the optional axes, never the literal "undefined".
		assert.doesNotMatch(table, /undefined/);
		const blankRow = table.split("\n").find((l) => l.includes("blank-agent"))!;
		assert.match(blankRow, /\| - \| - \| - \| - \|/);
	});

	it("escapes pipes and newlines in cells", () => {
		const table = renderWorkflowWorkerTable(
			snapshot([{ label: "weird|name", model: "a\nb", tokens: 1 }]),
		);
		assert.doesNotMatch(table, /weird\|name/); // pipe is escaped
		assert.match(table, /weird\\\|name/);
		assert.doesNotMatch(table, /a\nb/); // newline collapsed to space within the cell
	});

	it("returns empty string when there are no agents", () => {
		assert.equal(renderWorkflowWorkerTable(snapshot([])), "");
	});

	it("never labels tier as effort (tier column is its own header)", () => {
		const table = renderWorkflowWorkerTable(snapshot([{ label: "x", tier: "big", reasoning: "high" }]));
		const header = table.split("\n")[0]!;
		assert.match(header, /\| Tier \|/);
		assert.match(header, /\| Reasoning \|/);
		// tier=big and reasoning=high must appear in distinct columns, not merged.
		const row = table.split("\n")[2]!;
		assert.match(row, /\| big \| high \|/);
	});
});

describe("agentMetaText", () => {
	it("shows model · tier · reasoning when all present", () => {
		const text = agentMetaText({ model: "litellm/haiku-4.5", tier: "small", reasoning: "low" }, noTheme);
		assert.match(text, /model=litellm\/haiku-4\.5/);
		assert.match(text, /tier=small/);
		assert.match(text, /reasoning=low/);
		assert.match(text, / · /);
	});

	it("returns empty string when no axes are set", () => {
		assert.equal(agentMetaText({}, noTheme), "");
	});

	it("omits missing axes rather than printing key=-", () => {
		const text = agentMetaText({ model: "litellm/haiku-4.5", tier: "small" }, noTheme);
		assert.match(text, /model=litellm\/haiku-4\.5/);
		assert.match(text, /tier=small/);
		assert.doesNotMatch(text, /reasoning/);
	});
});