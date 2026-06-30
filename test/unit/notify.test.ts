import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import registerSubagentNotify from "../../src/runs/background/notify.ts";
import { SUBAGENT_ASYNC_COMPLETE_EVENT } from "../../src/shared/types.ts";

function createPi(options: {
	ownSessionId?: string;
	ownIntercom?: string;
	completionNotify?: "originator" | "all" | "off";
	unknownOwner?: "trigger" | "drop";
} = {}) {
	const events = new EventEmitter();
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		events,
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	};

	// Defaults simulate the originator: sessionId "me", intercom "me".
	registerSubagentNotify(pi as never, {
		getOwnSessionId: () => options.ownSessionId ?? "me",
		getOwnIntercomTarget: () => options.ownIntercom ?? "me",
		config: {
			completionNotify: options.completionNotify ?? "originator",
			unknownOwner: options.unknownOwner ?? "drop",
		},
	});

	return { events, sent };
}

function baseResult(overrides: Record<string, unknown> = {}) {
	return {
		id: "r-" + Math.random().toString(36).slice(2),
		agent: "worker",
		success: true,
		summary: "Done",
		exitCode: 0,
		timestamp: Date.now(),
		...overrides,
	};
}

function assertTriggerTurn(sent: Array<{ options: unknown }>) {
	assert.equal(sent.length, 1, "expected exactly one send");
	assert.deepEqual(sent[0].options, { triggerTurn: true });
}

describe("registerSubagentNotify", () => {
	it("originator (sessionId match) fires triggerTurn with formatted content", () => {
		const { events, sent } = createPi({ ownSessionId: "me", ownIntercom: "me" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionId: "me" }));
		assertTriggerTurn(sent);
		assert.match((sent[0].message as { content: string }).content, /Background task completed: \*\*worker\*\*/);
	});

	it("uses a fallback summary when a background completion is empty (originator)", () => {
		const { events, sent } = createPi();
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ summary: "", sessionId: "me" }));
		assertTriggerTurn(sent);
		assert.equal((sent[0].message as { content: string }).content, "Background task completed: **worker**\n\n(no output)");
	});

	it("preserves non-empty completion summaries + task index (originator)", () => {
		const { events, sent } = createPi();
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({
			summary: "Done streaming",
			taskIndex: 1, totalTasks: 3, sessionId: "me",
		}));
		assertTriggerTurn(sent);
		assert.equal((sent[0].message as { content: string }).content, "Background task completed: **worker** (2/3)\n\nDone streaming");
	});

	it("preserves session paths in notification content (originator)", () => {
		const { events, sent } = createPi();
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionFile: "/tmp/s.jsonl", sessionId: "me" }));
		assertTriggerTurn(sent);
		assert.equal((sent[0].message as { content: string }).content, "Background task completed: **worker**\n\nDone\n\nSession file: /tmp/s.jsonl");
	});

	it("labels paused completions as paused (originator)", () => {
		const { events, sent } = createPi();
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({
			success: false, state: "paused",
			summary: "Paused after interrupt. Waiting for explicit next action.",
			sessionId: "me",
		}));
		assertTriggerTurn(sent);
		assert.match((sent[0].message as { content: string }).content, /Background task paused: \*\*worker\*\*/);
	});

	it("non-originator (sessionId mismatch) sends NOTHING (no followUp, no flood)", () => {
		const { events, sent } = createPi({ ownSessionId: "my-session", ownIntercom: "my-target" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionId: "someone-else", intercomTarget: "their-target" }));
		assert.equal(sent.length, 0);
	});

	it("intercom-inactive originator (sessionId match, no intercomTarget) still fires triggerTurn (P1 regression guard)", () => {
		const { events, sent } = createPi({ ownSessionId: "me", ownIntercom: undefined });
		// result has sessionId but NO intercomTarget (intercom disabled at launch)
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionId: "me" }));
		assertTriggerTurn(sent);
	});

	it("secondary signal: intercomTarget match fires triggerTurn when sessionId absent (legacy result)", () => {
		const { events, sent } = createPi({ ownSessionId: undefined, ownIntercom: "my-target" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ intercomTarget: "my-target" }));
		assertTriggerTurn(sent);
	});

	it("completionNotify=all fires triggerTurn even for non-originators (legacy broadcast)", () => {
		const { events, sent } = createPi({ ownSessionId: "me", ownIntercom: "me", completionNotify: "all" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionId: "someone-else", intercomTarget: "their-target" }));
		assertTriggerTurn(sent);
	});

	it("completionNotify=off sends nothing (even for originator)", () => {
		const { events, sent } = createPi({ completionNotify: "off" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({ sessionId: "me" }));
		assert.equal(sent.length, 0);
	});

	it("unknown owner (no sessionId, no intercomTarget) defaults to drop (no send)", () => {
		const { events, sent } = createPi({ ownSessionId: "me", ownIntercom: "me" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({}));
		assert.equal(sent.length, 0);
	});

	it("unknownOwner=trigger fires triggerTurn for unattributed results (legacy)", () => {
		const { events, sent } = createPi({ ownSessionId: "me", ownIntercom: "me", unknownOwner: "trigger" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, baseResult({}));
		assertTriggerTurn(sent);
	});

	it("dedupes the same completion within the TTL window", () => {
		const { events, sent } = createPi();
		const r = baseResult({ sessionId: "me" });
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, r);
		events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, r);
		assert.equal(sent.length, 1);
	});
});