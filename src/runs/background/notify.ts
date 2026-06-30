/**
 * Subagent completion notifications.
 *
 * Originator scoping (WS-B): a generic `triggerTurn` notify is fired only by the
 * session that *launched* the run (the originator). Other sessions watching the
 * shared results dir do not fire a turn for runs they did not launch, which
 * stops idle sessions from being flooded with `Background task completed` turns.
 *
 * Ownership signal (durable, primary): `result.sessionId` — subagent-runner
 * writes `config.sessionId` into the result file, and `config.sessionId` is the
 * launching session's `currentSessionId` (= `resolveCurrentSessionId(sessionManager)`).
 * This is present for every run, including intercom-disabled installs, so it does
 * not regress the legacy inline-completion behavior.
 *
 * Secondary signal: `result.intercomTarget` (= `config.controlIntercomTarget`,
 * the launching session's intercom target), present when intercom is active.
 * Used as a fallback when `sessionId` is absent on legacy result files.
 *
 * Non-originators send nothing by default (a followUp message still writes a
 * visible transcript row, which is the flooding we are eliminating). The
 * `completionNotify` and `unknownOwner` config knobs preserve the legacy
 * broadcast for operators who want it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCompletionKey, getGlobalSeenMap, markSeenWithTtl } from "./completion-dedupe.ts";
import { SUBAGENT_ASYNC_COMPLETE_EVENT } from "../../shared/types.ts";

export type CompletionNotifyMode = "originator" | "all" | "off";
export type UnknownOwnerMode = "trigger" | "drop";

export interface SubagentNotifyConfig {
	/** Who gets a `triggerTurn` inline completion notify. Default "originator". */
	completionNotify?: CompletionNotifyMode;
	/**
	 * What to do for a legacy/edge result that lacks any usable owner signal
	 * (no `sessionId` AND no `intercomTarget`). Default "drop" (do nothing).
	 * "trigger" preserves the legacy broadcast for results with no owner attribution.
	 */
	unknownOwner?: UnknownOwnerMode;
}

export interface SubagentNotifyDetails {
	agent: string;
	status: "completed" | "failed" | "paused";
	taskInfo?: string;
	resultPreview: string;
	durationMs?: number;
	sessionLabel?: string;
	sessionValue?: string;
}

interface ChainStepResult {
	agent: string;
	output: string;
	success: boolean;
}

interface SubagentResult {
	id: string | null;
	agent: string | null;
	success: boolean;
	summary: string;
	exitCode?: number;
	state?: string;
	timestamp: number;
	durationMs?: number;
	sessionFile?: string;
	shareUrl?: string;
	gistUrl?: string;
	shareError?: string;
	results?: ChainStepResult[];
	taskIndex?: number;
	totalTasks?: number;
	/** Durable originator runtime session id (written by subagent-runner). */
	sessionId?: string;
	/** Durable originator intercom target, present when intercom is active. */
	intercomTarget?: string;
}

/**
 * Resolve this session's own identity, for originator comparison.
 * Returns undefined if identity is not yet known (e.g. before session_start).
 */
export type OwnIdentityResolver = () => string | undefined;

export interface RegisterSubagentNotifyOptions {
	/** Resolve this session's own runtime session id. Required for originator scoping. */
	getOwnSessionId: OwnIdentityResolver;
	/** Resolve this session's own intercom target (secondary signal). */
	getOwnIntercomTarget: OwnIdentityResolver;
	/** Notify policy. Defaults to { completionNotify: "originator", unknownOwner: "drop" }. */
	config?: SubagentNotifyConfig;
}

export default function registerSubagentNotify(
	pi: ExtensionAPI,
	options: RegisterSubagentNotifyOptions,
): void {
	const completionNotify = options.config?.completionNotify ?? "originator";
	const unknownOwner = options.config?.unknownOwner ?? "drop";

	const unsubscribeStoreKey = "__pi_subagents_notify_unsubscribe__";
	const globalStore = globalThis as Record<string, unknown>;
	const previousUnsubscribe = globalStore[unsubscribeStoreKey];
	if (typeof previousUnsubscribe === "function") {
		try {
			previousUnsubscribe();
		} catch {
			// Best effort cleanup for stale handlers from an older reload.
		}
	}

	const seen = getGlobalSeenMap("__pi_subagents_notify_seen__");
	const ttlMs = 10 * 60 * 1000;

	const handleComplete = (data: unknown) => {
		const result = data as SubagentResult;
		const now = Date.now();
		const key = buildCompletionKey(result, "notify");
		if (markSeenWithTtl(seen, key, now, ttlMs)) return;

		const agent = result.agent ?? "unknown";
		const summary = typeof result.summary === "string" ? result.summary : "";
		const paused = !result.success && (
			result.exitCode === 0
			|| result.state === "paused"
			|| summary.startsWith("Paused after interrupt.")
		);
		const status = paused ? "paused" : result.success ? "completed" : "failed";

		const taskInfo =
			result.taskIndex !== undefined && result.totalTasks !== undefined
				? ` (${result.taskIndex + 1}/${result.totalTasks})`
				: "";

		const sessionLine = result.shareUrl
			? `Session: ${result.shareUrl}`
			: result.shareError
				? `Session share error: ${result.shareError}`
				: result.sessionFile
					? `Session file: ${result.sessionFile}`
					: undefined;

		const displaySummary = summary.trim() ? summary : "(no output)";
		const content = [
			`Background task ${status}: **${agent}**${taskInfo}`,
			"",
			displaySummary,
			sessionLine ? "" : undefined,
			sessionLine,
		]
			.filter((line) => line !== undefined)
			.join("\n");

		const trigger = () =>
			pi.sendMessage(
				{ customType: "subagent-notify", content, display: true },
				{ triggerTurn: true },
			);

		// --- Decision order (WS-B) ---
		if (completionNotify === "off") return;
		if (completionNotify === "all") {
			trigger(); // legacy broadcast: every session fires the inline notify
			return;
		}

		// completionNotify === "originator" (default)
		const ownSessionId = options.getOwnSessionId();
		const ownIntercom = options.getOwnIntercomTarget();
		const ownerSessionId = typeof result.sessionId === "string" ? result.sessionId.trim() : "";
		const ownerIntercom = typeof result.intercomTarget === "string" ? result.intercomTarget.trim() : "";

		// Primary: runtime session id match (present for every run, incl. intercom-disabled).
		if (ownSessionId && ownerSessionId && ownSessionId === ownerSessionId) {
			trigger();
			return;
		}
		// Secondary: intercom target match (intercom-active runs; legacy result files).
		if (ownIntercom && ownerIntercom && ownIntercom === ownerIntercom) {
			trigger();
			return;
		}

		// Known non-originator (owner signal present but does not match): send nothing.
		if (ownerSessionId || ownerIntercom) {
			return;
		}

		// No owner signal at all (legacy/edge result file). Apply unknownOwner policy.
		if (unknownOwner === "trigger") {
			trigger(); // legacy: treat unattributed completions as ours
			return;
		}
		// unknownOwner === "drop" (default): do nothing.
	};

	globalStore[unsubscribeStoreKey] = pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, handleComplete);
}