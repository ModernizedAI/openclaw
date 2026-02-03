/**
 * Orchestrator - Manages task execution with safety, cost control, and traceability
 */

import crypto from "node:crypto";

/**
 * Hard limits for orchestrator runs
 */
export interface OrchestratorLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxRetriesPerTool: number;
  maxSecondsPerStep: number;
  maxOutputBytesReturned: number;
}

/**
 * Default limits
 */
export const DEFAULT_LIMITS: OrchestratorLimits = {
  maxSteps: 12,
  maxToolCalls: 20,
  maxRetriesPerTool: 2,
  maxSecondsPerStep: 60,
  maxOutputBytesReturned: 16384,
};

/**
 * Model routing modes
 */
export type ModelMode = "cheap" | "premium";

/**
 * Escalation triggers for premium mode
 */
export interface EscalationTriggers {
  highStakes: boolean; // prod/security/infra/customer-facing
  ambiguity: boolean; // conflicting signals or missing context
  failures: boolean; // invalid schema or repeated failures > 2
  complexity: boolean; // >6 tool calls or >2 subsystems
  finalOutput: boolean; // sent to stakeholders
}

/**
 * Run statistics
 */
export interface RunStats {
  stepCount: number;
  toolCallCount: number;
  retriesByTool: Map<string, number>;
  startTime: number;
  totalTokens: number;
  modelMode: ModelMode;
  escalationReasons: string[];
}

/**
 * Evidence excerpt for reports
 */
export interface Evidence {
  source: string;
  lineRange?: [number, number];
  excerpt: string;
  relevance: string;
}

/**
 * Structured output for orchestrator runs
 */
export interface StructuredOutput {
  runId: string;
  status: "success" | "failure" | "checkpoint" | "needs_input";
  tldr: string[];
  findings: string[];
  evidence: Evidence[];
  nextActions: string[];
  risks: string[];
  artifactPaths: string[];
  confidence: number;
  stats: {
    steps: number;
    toolCalls: number;
    durationMs: number;
    modelMode: ModelMode;
  };
}

/**
 * Checkpoint for write actions
 */
export interface Checkpoint {
  type: "checkpoint";
  proposedAction: string;
  commands?: string[];
  diff?: string;
  risks: string[];
  verification: string[];
  requiresApproval: true;
}

/**
 * Run context for the orchestrator
 */
export interface OrchestratorContext {
  runId: string;
  goal: string;
  limits: OrchestratorLimits;
  stats: RunStats;
  artifacts: Map<string, string>;
  log: RunLogEntry[];
}

/**
 * Run log entry
 */
export interface RunLogEntry {
  timestamp: number;
  type: "step" | "tool_call" | "escalation" | "checkpoint" | "error";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Create a new orchestrator context
 */
export function createOrchestratorContext(
  goal: string,
  limits: Partial<OrchestratorLimits> = {},
): OrchestratorContext {
  return {
    runId: crypto.randomUUID(),
    goal,
    limits: { ...DEFAULT_LIMITS, ...limits },
    stats: {
      stepCount: 0,
      toolCallCount: 0,
      retriesByTool: new Map(),
      startTime: Date.now(),
      totalTokens: 0,
      modelMode: "cheap",
      escalationReasons: [],
    },
    artifacts: new Map(),
    log: [],
  };
}

/**
 * Log an entry to the run log
 */
export function logEntry(
  ctx: OrchestratorContext,
  type: RunLogEntry["type"],
  message: string,
  data?: Record<string, unknown>,
): void {
  ctx.log.push({
    timestamp: Date.now(),
    type,
    message,
    data,
  });
}

/**
 * Check if limits are exceeded
 */
export function checkLimits(ctx: OrchestratorContext): {
  exceeded: boolean;
  reason?: string;
} {
  if (ctx.stats.stepCount >= ctx.limits.maxSteps) {
    return { exceeded: true, reason: `Max steps (${ctx.limits.maxSteps}) exceeded` };
  }
  if (ctx.stats.toolCallCount >= ctx.limits.maxToolCalls) {
    return { exceeded: true, reason: `Max tool calls (${ctx.limits.maxToolCalls}) exceeded` };
  }
  return { exceeded: false };
}

/**
 * Increment step count
 */
export function incrementStep(ctx: OrchestratorContext): void {
  ctx.stats.stepCount++;
  logEntry(ctx, "step", `Step ${ctx.stats.stepCount}`);
}

/**
 * Record a tool call
 */
export function recordToolCall(ctx: OrchestratorContext, toolName: string, success: boolean): void {
  ctx.stats.toolCallCount++;

  if (!success) {
    const retries = ctx.stats.retriesByTool.get(toolName) || 0;
    ctx.stats.retriesByTool.set(toolName, retries + 1);

    if (retries + 1 > ctx.limits.maxRetriesPerTool) {
      logEntry(ctx, "error", `Tool ${toolName} exceeded max retries`, {
        retries: retries + 1,
        max: ctx.limits.maxRetriesPerTool,
      });
    }
  }

  logEntry(ctx, "tool_call", `Tool: ${toolName}`, { success });
}

/**
 * Check if tool has exceeded retries
 */
export function hasExceededRetries(ctx: OrchestratorContext, toolName: string): boolean {
  const retries = ctx.stats.retriesByTool.get(toolName) || 0;
  return retries >= ctx.limits.maxRetriesPerTool;
}

/**
 * Determine model mode based on triggers
 */
export function determineModelMode(triggers: Partial<EscalationTriggers>): {
  mode: ModelMode;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (triggers.highStakes) {
    reasons.push("high_stakes: prod/security/infra/customer-facing output");
  }
  if (triggers.ambiguity) {
    reasons.push("ambiguity: conflicting signals or missing context");
  }
  if (triggers.failures) {
    reasons.push("failures: invalid schema or repeated failures > 2");
  }
  if (triggers.complexity) {
    reasons.push("complexity: >6 tool calls or >2 subsystems involved");
  }
  if (triggers.finalOutput) {
    reasons.push("final_output: sent to stakeholders");
  }

  return {
    mode: reasons.length > 0 ? "premium" : "cheap",
    reasons,
  };
}

/**
 * Escalate to premium mode
 */
export function escalateMode(
  ctx: OrchestratorContext,
  triggers: Partial<EscalationTriggers>,
): void {
  const { mode, reasons } = determineModelMode(triggers);

  if (mode === "premium" && ctx.stats.modelMode === "cheap") {
    ctx.stats.modelMode = "premium";
    ctx.stats.escalationReasons.push(...reasons);
    logEntry(ctx, "escalation", "Escalated to premium mode", { reasons });
  }
}

/**
 * Create a checkpoint for write actions
 */
export function createCheckpoint(
  proposedAction: string,
  options: {
    commands?: string[];
    diff?: string;
    risks?: string[];
    verification?: string[];
  } = {},
): Checkpoint {
  return {
    type: "checkpoint",
    proposedAction,
    commands: options.commands,
    diff: options.diff,
    risks: options.risks || [],
    verification: options.verification || [],
    requiresApproval: true,
  };
}

/**
 * Build structured output from context
 */
export function buildStructuredOutput(
  ctx: OrchestratorContext,
  result: {
    status: StructuredOutput["status"];
    tldr: string[];
    findings: string[];
    evidence?: Evidence[];
    nextActions?: string[];
    risks?: string[];
    confidence: number;
  },
): StructuredOutput {
  return {
    runId: ctx.runId,
    status: result.status,
    tldr: result.tldr,
    findings: result.findings,
    evidence: result.evidence || [],
    nextActions: result.nextActions || [],
    risks: result.risks || [],
    artifactPaths: Array.from(ctx.artifacts.keys()),
    confidence: result.confidence,
    stats: {
      steps: ctx.stats.stepCount,
      toolCalls: ctx.stats.toolCallCount,
      durationMs: Date.now() - ctx.stats.startTime,
      modelMode: ctx.stats.modelMode,
    },
  };
}

/**
 * Truncate output to max bytes
 */
export function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output) <= maxBytes) {
    return output;
  }

  // Binary search for the right length
  let low = 0;
  let high = output.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (Buffer.byteLength(output.slice(0, mid)) <= maxBytes - 20) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return output.slice(0, low) + "\n[TRUNCATED]";
}

/**
 * Store an artifact and return its path
 */
export function storeArtifact(ctx: OrchestratorContext, name: string, content: string): string {
  const path = `artifacts/${ctx.runId}/${name}`;
  ctx.artifacts.set(path, content);
  return path;
}

/**
 * Format run log as markdown
 */
export function formatRunLog(ctx: OrchestratorContext): string {
  const lines: string[] = [
    `# Run Log: ${ctx.runId}`,
    "",
    `**Goal:** ${ctx.goal}`,
    `**Started:** ${new Date(ctx.stats.startTime).toISOString()}`,
    `**Duration:** ${Date.now() - ctx.stats.startTime}ms`,
    `**Steps:** ${ctx.stats.stepCount}/${ctx.limits.maxSteps}`,
    `**Tool Calls:** ${ctx.stats.toolCallCount}/${ctx.limits.maxToolCalls}`,
    `**Mode:** ${ctx.stats.modelMode}`,
    "",
    "## Log",
    "",
  ];

  for (const entry of ctx.log) {
    const time = new Date(entry.timestamp).toISOString().split("T")[1];
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    lines.push(`- \`${time}\` [${entry.type}] ${entry.message}${dataStr}`);
  }

  return lines.join("\n");
}
