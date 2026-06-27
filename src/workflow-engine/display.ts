import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentHistoryEntry } from "./agent-history.ts";
import type { WorkflowErrorCode } from "./errors.ts";
import type { WorkflowMeta } from "./workflow.ts";

export type WorkflowAgentStatus = "queued" | "running" | "done" | "error" | "skipped";

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phase?: string;
  prompt: string;
  status: WorkflowAgentStatus;
  resultPreview?: string;
  error?: string;
  errorCode?: WorkflowErrorCode;
  recoverable?: boolean;
  history?: AgentHistoryEntry[];
  /** Tokens used by this agent. */
  tokens?: number;
  /** The model this agent ran on (provider/id), when known. */
  model?: string;
  /** Routing tier requested for this agent (small/medium/big). Set at agentStart; not the compute-effort axis.
   * Vendor seam — enhancement-ideas §2. */
  tier?: string;
  /** Agent type / role label (e.g. "worker", "oracle", "planner"). Set at agentStart.
   * Vendor seam — enhancement-ideas §2. */
  agentType?: string;
  /** Model reasoning / compute effort when available (workflow workers usually render "-").
   * Unified alias for the model thinking level (subagent side maps it from `thinking`). */
  reasoning?: string;
  /** ISO timestamp when this agent originally started. Preserved across resume replay. */
  startedAt?: string;
  /** ISO timestamp when this agent originally ended. Preserved across resume replay. */
  endedAt?: string;
}

export interface WorkflowSnapshot {
  name: string;
  description?: string;
  phases: string[];
  currentPhase?: string;
  logs: string[];
  agents: WorkflowAgentSnapshot[];
  agentCount: number;
  runningCount: number;
  doneCount: number;
  errorCount: number;
  durationMs?: number;
  result?: unknown;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cost?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  runId?: string;
}

export interface WorkflowDisplay {
  update(snapshot: WorkflowSnapshot): void;
  complete(snapshot: WorkflowSnapshot): void;
  clear(): void;
}

export interface WorkflowDisplayOptions {
  key?: string;
  placement?: "aboveEditor" | "belowEditor";
  maxAgents?: number;
  showStatus?: boolean;
  showResultPreviews?: boolean;
}

export function createWorkflowSnapshot(meta: WorkflowMeta): WorkflowSnapshot {
  return {
    name: meta.name,
    description: meta.description,
    phases: meta.phases?.map((phase) => phase.title) ?? [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
  };
}

export function recomputeWorkflowSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const runningCount = snapshot.agents.filter((agent) => agent.status === "running").length;
  const doneCount = snapshot.agents.filter((agent) => agent.status === "done").length;
  const errorCount = snapshot.agents.filter((agent) => agent.status === "error").length;
  return { ...snapshot, agentCount: snapshot.agents.length, runningCount, doneCount, errorCount };
}

export function createWidgetWorkflowDisplay(
  ctx: Pick<ExtensionContext, "ui" | "hasUI">,
  options: WorkflowDisplayOptions = {},
): WorkflowDisplay {
  const key = options.key ?? "workflow";
  const placement = options.placement ?? "belowEditor";
  const showStatus = options.showStatus ?? false;

  // Mutable state captured by the component closure so re-renders
  // always read the latest snapshot even though the factory ran once.
  let snapshot: WorkflowSnapshot | undefined;
  let completed = false;

  // Store the factory so update()/complete() can re-register it to trigger re-render.
  const widgetFactory = (_tui: unknown, theme: Theme) => ({
    render: () => (snapshot ? renderWorkflowLines(snapshot, options, theme) : []),
    invalidate: () => {},
  });

  if (ctx.hasUI) {
    ctx.ui.setWidget(key, widgetFactory, { placement });
  }

  return {
    update(s) {
      snapshot = s;
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, statusLine(s, completed));
      ctx.ui.setWidget(key, widgetFactory, { placement });
    },
    complete(s) {
      snapshot = s;
      completed = true;
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, statusLine(s, true));
      ctx.ui.setWidget(key, widgetFactory, { placement });
    },
    clear() {
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, undefined);
      ctx.ui.setWidget(key, undefined);
    },
  };
}

export function createToolUpdateWorkflowDisplay(
  onUpdate: ((result: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) | undefined,
  ctx?: Pick<ExtensionContext, "ui" | "hasUI">,
  options: WorkflowDisplayOptions & { streamToolUpdates?: boolean } = {},
): WorkflowDisplay {
  const widget = ctx ? createWidgetWorkflowDisplay(ctx, options) : undefined;
  const streamToolUpdates = options.streamToolUpdates ?? !ctx?.hasUI;

  const emit = (snapshot: WorkflowSnapshot, completed = false) => {
    if (streamToolUpdates) {
      onUpdate?.({
        content: [{ type: "text", text: renderWorkflowText(snapshot, completed) }],
        details: snapshot,
      });
    }
    if (completed) widget?.complete(snapshot);
    else widget?.update(snapshot);
  };

  return {
    update(snapshot) {
      emit(snapshot, false);
    },
    complete(snapshot) {
      emit(snapshot, true);
    },
    clear() {
      widget?.clear();
    },
  };
}

/** Minimal theme surface so rendering works without a real Theme (tool output, tests). */
export interface ThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** Identity passthrough for contexts where no theme is available (tool text output). */
const NO_THEME: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

export function renderWorkflowLines(
  snapshot: WorkflowSnapshot,
  options: WorkflowDisplayOptions = {},
  theme: ThemeLike = NO_THEME,
): string[] {
  const maxAgents = options.maxAgents ?? 8;
  const showResultPreviews = options.showResultPreviews ?? false;
  const state =
    snapshot.errorCount > 0
      ? `, ${snapshot.errorCount} errors`
      : snapshot.runningCount > 0
        ? `, ${snapshot.runningCount} running`
        : "";
  // Build header with token info (and cost when the provider reports it)
  const usage = snapshot.tokenUsage;
  const costInfo = usage?.cost ? ` · $${usage.cost.toFixed(4)}` : "";
  const tokenInfo = usage ? ` · ${usage.total.toLocaleString()} tokens${costInfo}` : "";
  const lines = [
    `${theme.bold(`◆ Workflow: ${snapshot.name}`)} (${snapshot.doneCount}/${snapshot.agentCount} done${state}${tokenInfo})`,
  ];

  const phaseNames = snapshot.phases.length
    ? snapshot.phases
    : unique(snapshot.agents.map((agent) => agent.phase).filter(Boolean) as string[]);
  const rendered = new Set<WorkflowAgentSnapshot>();

  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase);
    for (const agent of agents) rendered.add(agent);
    const done = agents.filter((agent) => agent.status === "done").length;
    const running = agents.filter((agent) => agent.status === "running").length;
    const errors = agents.filter((agent) => agent.status === "error").length;
    const skipped = agents.filter((agent) => agent.status === "skipped").length;
    const complete = agents.length > 0 && done + errors + skipped === agents.length;
    const marker = running > 0 || (!complete && snapshot.currentPhase === phase) ? "▶" : complete ? "✓" : " ";
    lines.push(
      theme.fg("accent", `  ${marker} ${phase}`) +
        theme.fg(
          "dim",
          ` ${done}/${agents.length}${running ? ` · ${running} running` : ""}${errors ? ` · ${errors} errors` : ""}${skipped ? ` · ${skipped} skipped` : ""}`,
        ),
    );

    const visibleAgents = agents.slice(-maxAgents);
    for (const agent of visibleAgents) {
      const order = `[${agent.id}]`;
      const result = showResultPreviews && agent.resultPreview ? ` — ${agent.resultPreview}` : "";
      const meta = agentMetaText(agent, theme);
      const agentTokens = agent.tokens ? theme.fg("dim", ` [${agent.tokens.toLocaleString()} tok]`) : "";
      const errTxt = agentErrorText(agent, theme);
      lines.push(
        `    ${order} ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${meta}${errTxt}${agentTokens}${result}`,
      );
    }
    if (agents.length > visibleAgents.length)
      lines.push(theme.fg("dim", `    … ${agents.length - visibleAgents.length} earlier agents`));
  }

  const unphased = snapshot.agents.filter((agent) => !rendered.has(agent));
  if (unphased.length) {
    lines.push(theme.fg("accent", "  Unphased"));
    for (const agent of unphased.slice(-maxAgents)) {
      const result = showResultPreviews && agent.resultPreview ? ` — ${agent.resultPreview}` : "";
      const meta = agentMetaText(agent, theme);
      const agentTokens = agent.tokens ? theme.fg("dim", ` [${agent.tokens.toLocaleString()} tok]`) : "";
      const errTxt = agentErrorText(agent, theme);
      lines.push(
        `    [${agent.id}] ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${meta}${errTxt}${agentTokens}${result}`,
      );
    }
  }

  return lines;
}

export function renderWorkflowText(snapshot: WorkflowSnapshot, completed = false): string {
  const header = completed ? "Workflow completed" : "Workflow running";
  return [header, ...renderWorkflowLines(snapshot)].join("\n");
}

function statusLine(snapshot: WorkflowSnapshot, completed: boolean): string {
  if (completed) return `workflow ✓ ${snapshot.name}: ${snapshot.doneCount}/${snapshot.agentCount}`;
  if (snapshot.runningCount > 0)
    return `workflow ${snapshot.name}: ${snapshot.runningCount} running, ${snapshot.doneCount}/${snapshot.agentCount} done`;
  return `workflow ${snapshot.name}: ${snapshot.doneCount}/${snapshot.agentCount} done`;
}

export function statusIcon(status: WorkflowAgentStatus): string {
  switch (status) {
    case "queued":
      return "○";
    case "running":
      return "●";
    case "done":
      return "✓";
    case "error":
      return "✗";
    case "skipped":
      return "-";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function shorten(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  // Slice by Unicode code point so we never split a UTF-16 surrogate pair —
  // an astral-plane char/emoji at the boundary would otherwise leave a lone
  // surrogate that renders as a replacement character (\uFFFD).
  const chars = Array.from(text);
  return `${chars.slice(0, max - 1).join("")}…`;
}

/** First non-empty, trimmed line of a (possibly multi-line) message. Keeps the
 * actionable summary instead of space-joining a whole stack trace into one
 * flattened blob that a coarse length cap then clips to a generic prefix. */
export function firstLine(value: string | undefined | null): string {
  if (!value) return "";
  for (const line of value.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/** Inline error suffix for an errored agent row — shared by both the detailed
 * task panel and the live workflow widget so the two renderers cannot diverge.
 * Renders the first non-empty error line (surrogate-safe), and returns "" when
 * there is no error or the error is blank/whitespace-only (no dangling ` — `). */
export function agentErrorText(agent: { status: string; error?: string }, theme: ThemeLike, max = 60): string {
  if (agent.status !== "error") return "";
  const text = shorten(firstLine(agent.error), max);
  return text ? theme.fg("error", ` — ${text}`) : "";
}

/** Inline per-agent model/tier/reasoning metadata for the live workflow widget.
 * Shows each non-empty axis as `key=value`, joined by ` · `. Returns "" when none
 * are set so an agent with no routing metadata renders unchanged. Workflow
 * workers usually have `tier` and `model` but no `reasoning` (the model thinking
 * level is not surfaced by the workflow engine today). */
export function agentMetaText(
  agent: { model?: string; tier?: string; reasoning?: string },
  theme: ThemeLike,
): string {
  const parts: string[] = [];
  if (agent.model) parts.push(`model=${agent.model}`);
  if (agent.tier) parts.push(`tier=${agent.tier}`);
  if (agent.reasoning) parts.push(`reasoning=${agent.reasoning}`);
  return parts.length ? theme.fg("dim", ` [${parts.join(" · ")}]`) : "";
}

/** Compact Markdown table of every workflow worker (no maxAgents truncation) for
 * the tool-result / background-completion message. `tier` is the routing bucket
 * (small/medium/big), `reasoning` is the model compute-effort level (usually
 * `-` for workflow workers). Per the enhancement-ideas plan, never label tier as
 * effort. Cells escape `|`/newlines. */
export function renderWorkflowWorkerTable(snapshot: WorkflowSnapshot): string {
  const agents = snapshot.agents ?? [];
  if (agents.length === 0) return "";
  const header = ["#", "Status", "Label", "Phase", "Model", "Tier", "Reasoning", "Tokens"];
  const sep = ["--", "------", "-----", "-----", "-----", "----", "---------", "------"];
  const rows = agents.map((a) => [
    String(a.id),
    a.status,
    a.label,
    a.phase ?? "-",
    a.model ?? "-",
    a.tier ?? "-",
    a.reasoning ?? "-",
    a.tokens ? a.tokens.toLocaleString() : "-",
  ]);
  const all = [header, sep, ...rows];
  return all.map((r) => `| ${r.map(escapeCell).join(" | ")} |`).join("\n");
}

function escapeCell(value: string): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function preview(value: unknown, max = 80): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
