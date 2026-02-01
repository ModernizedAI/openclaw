/**
 * Runtime context for mzd runs
 */

import { randomBytes } from "node:crypto";
import type { MzdConfig, WorkspaceConfig } from "../config/types.js";

/**
 * Unique identifier for a run
 */
export type RunId = string;

/**
 * Generate a new run ID
 */
export function generateRunId(): RunId {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString("hex");
  return `run_${timestamp}_${random}`;
}

/**
 * Log entry for audit trail
 */
export interface AuditLogEntry {
  timestamp: Date;
  runId: RunId;
  type: "tool_call" | "approval" | "patch" | "command" | "error";
  tool?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  approved?: boolean;
  approvedBy?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Run context containing state for a single agent run
 */
export interface RunContext {
  /** Unique run identifier */
  runId: RunId;
  /** Start time of the run */
  startTime: Date;
  /** Active workspace configuration */
  workspace: WorkspaceConfig;
  /** Full configuration */
  config: MzdConfig;
  /** Audit log entries */
  auditLog: AuditLogEntry[];
  /** Whether the run is in trace mode */
  traceMode: boolean;
  /** Turn counter for capped loops */
  turnCount: number;
  /** Maximum turns allowed */
  maxTurns: number;
  /** Pending approvals */
  pendingApprovals: Map<string, PendingApproval>;
}

/**
 * Pending approval request
 */
export interface PendingApproval {
  id: string;
  type: "write" | "exec" | "patch";
  description: string;
  details: unknown;
  createdAt: Date;
  timeoutAt: Date;
}

/**
 * Create a new run context
 */
export function createRunContext(
  config: MzdConfig,
  workspace: WorkspaceConfig,
  options?: {
    traceMode?: boolean;
    maxTurns?: number;
  },
): RunContext {
  return {
    runId: generateRunId(),
    startTime: new Date(),
    workspace,
    config,
    auditLog: [],
    traceMode: options?.traceMode ?? false,
    turnCount: 0,
    maxTurns: options?.maxTurns ?? 100,
    pendingApprovals: new Map(),
  };
}

/**
 * Add an audit log entry
 */
export function addAuditEntry(
  ctx: RunContext,
  entry: Omit<AuditLogEntry, "timestamp" | "runId">,
): void {
  ctx.auditLog.push({
    ...entry,
    timestamp: new Date(),
    runId: ctx.runId,
  });
}

/**
 * Get run summary
 */
export function getRunSummary(ctx: RunContext): {
  runId: RunId;
  duration_ms: number;
  turnCount: number;
  toolCalls: number;
  approvals: number;
  errors: number;
  patchesApplied: number;
  commandsRun: number;
} {
  const now = new Date();
  const duration_ms = now.getTime() - ctx.startTime.getTime();

  return {
    runId: ctx.runId,
    duration_ms,
    turnCount: ctx.turnCount,
    toolCalls: ctx.auditLog.filter((e) => e.type === "tool_call").length,
    approvals: ctx.auditLog.filter((e) => e.type === "approval" && e.approved).length,
    errors: ctx.auditLog.filter((e) => e.type === "error").length,
    patchesApplied: ctx.auditLog.filter((e) => e.type === "patch").length,
    commandsRun: ctx.auditLog.filter((e) => e.type === "command").length,
  };
}
