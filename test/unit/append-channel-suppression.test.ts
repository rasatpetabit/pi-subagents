import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPiArgs } from "../../src/runs/shared/pi-args.ts";

/**
 * Regression guard: subagents must NOT inherit the main agent's append-system
 * channel (`.pi/APPEND_SYSTEM.md` / `~/.pi/agent/APPEND_SYSTEM.md`).
 *
 * Why this works WITHOUT a dedicated flag: Pi's resource loader resolves the
 * append channel as
 *
 *     appendSources = this.appendSystemPromptSource
 *                     ?? (discoverAppendSystemPromptFile() ? [...] : [])
 *
 * (@earendil-works/pi-coding-agent, dist/core/resource-loader.js, ~L335). The
 * `??` means: if a CLI `--append-system-prompt` (or `--system-prompt`) is
 * supplied, auto-discovery of APPEND_SYSTEM.md is short-circuited entirely.
 * buildPiArgs ALWAYS emits one of those args whenever a role/system prompt is
 * present (pi-args.ts ~L143), so the main-agent rules channel never leaks into
 * a spawned child. This is the same outcome OpenCode-style
 * `inheritMainRules:false` produces in SDK-spawned engines — we get it for free
 * because we spawn via the Pi CLI with our own prompt path.
 *
 * If a future refactor stops passing a prompt path (systemPrompt undefined),
 * Pi WOULD discover and inherit APPEND_SYSTEM.md. These assertions fail loudly
 * if that suppression arg ever stops being emitted.
 */
describe("append-channel suppression (main-agent rules don't leak into subagents)", () => {
	const base = {
		baseArgs: ["-p"],
		task: "hello",
		sessionEnabled: false,
		inheritProjectContext: false,
		inheritSkills: false,
	} as const;

	it("append mode emits --append-system-prompt, which short-circuits APPEND_SYSTEM.md discovery", () => {
		const { args } = buildPiArgs({
			...base,
			systemPrompt: "You are a focused subagent.",
			systemPromptMode: "append",
		});
		assert.ok(
			args.includes("--append-system-prompt"),
			"append mode must pass --append-system-prompt so Pi skips APPEND_SYSTEM.md auto-discovery",
		);
		assert.ok(
			!args.includes("--system-prompt"),
			"append mode must not use --system-prompt",
		);
	});

	it("replace mode emits --system-prompt, which also suppresses the append channel", () => {
		const { args } = buildPiArgs({
			...base,
			systemPrompt: "You are a focused subagent.",
			systemPromptMode: "replace",
		});
		assert.ok(
			args.includes("--system-prompt"),
			"replace mode must pass --system-prompt (full base-prompt replacement)",
		);
		assert.ok(
			!args.includes("--append-system-prompt"),
			"replace mode must not use --append-system-prompt",
		);
	});

	it("a role prompt always yields exactly one prompt-suppression arg", () => {
		for (const mode of ["append", "replace"] as const) {
			const { args } = buildPiArgs({
				...base,
				systemPrompt: "role",
				systemPromptMode: mode,
			});
			const suppressors = args.filter(
				(a) => a === "--append-system-prompt" || a === "--system-prompt",
			);
			assert.equal(
				suppressors.length,
				1,
				`exactly one suppression arg expected for ${mode} mode`,
			);
		}
	});
});
