/**
 * Approval flow for write and exec operations
 */

import readline from "node:readline";
import { randomBytes } from "node:crypto";
import type { RunContext, PendingApproval } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import { addAuditEntry } from "../runtime/context.js";

/**
 * Approval result
 */
export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  approvedBy?: string;
}

/**
 * Create a pending approval request
 */
export function createApprovalRequest(
  ctx: RunContext,
  type: PendingApproval["type"],
  description: string,
  details: unknown,
): PendingApproval {
  const id = randomBytes(4).toString("hex");
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + ctx.config.approvals.approvalTimeoutMs);

  const approval: PendingApproval = {
    id,
    type,
    description,
    details,
    createdAt: now,
    timeoutAt,
  };

  ctx.pendingApprovals.set(id, approval);
  return approval;
}

/**
 * Check if an approval request has timed out
 */
export function isApprovalTimedOut(approval: PendingApproval): boolean {
  return new Date() > approval.timeoutAt;
}

/**
 * Format approval request for display
 */
export function formatApprovalRequest(approval: PendingApproval): string {
  const lines: string[] = [];

  lines.push("┌─────────────────────────────────────────────────");
  lines.push(`│ APPROVAL REQUIRED: ${approval.type.toUpperCase()}`);
  lines.push("├─────────────────────────────────────────────────");
  lines.push(`│ ID: ${approval.id}`);
  lines.push(`│ ${approval.description}`);
  lines.push("├─────────────────────────────────────────────────");

  // Format details based on type
  if (approval.type === "patch") {
    const details = approval.details as { paths: string[]; preview?: string };
    lines.push("│ Files to modify:");
    for (const path of details.paths.slice(0, 10)) {
      lines.push(`│   - ${path}`);
    }
    if (details.paths.length > 10) {
      lines.push(`│   ... and ${details.paths.length - 10} more files`);
    }
    if (details.preview) {
      lines.push("├─────────────────────────────────────────────────");
      lines.push("│ Preview:");
      for (const line of details.preview.split("\n").slice(0, 20)) {
        lines.push(`│ ${line}`);
      }
    }
  } else if (approval.type === "exec") {
    const details = approval.details as { command: string; args: string[]; cwd: string };
    lines.push(`│ Command: ${details.command} ${details.args.join(" ")}`);
    lines.push(`│ Working dir: ${details.cwd}`);
  } else if (approval.type === "write") {
    const details = approval.details as { path: string; operation: string };
    lines.push(`│ Operation: ${details.operation}`);
    lines.push(`│ Path: ${details.path}`);
  }

  lines.push("├─────────────────────────────────────────────────");
  lines.push("│ [y]es / [n]o / [v]iew details / [s]kip");
  lines.push("└─────────────────────────────────────────────────");

  return lines.join("\n");
}

/**
 * Request interactive approval from the user
 */
export async function requestApproval(
  approval: PendingApproval,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ApprovalResult> {
  // Check if we should auto-approve
  if (shouldAutoApprove(approval, ctx)) {
    logger.info(`Auto-approved: ${approval.description}`);
    addAuditEntry(ctx, {
      type: "approval",
      approved: true,
      approvedBy: "auto",
    });
    return { approved: true, approvedBy: "auto", reason: "auto-approved by pattern" };
  }

  // Display the approval request
  console.log("\n" + formatApprovalRequest(approval));

  // Create readline interface for interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Set timeout
    const timeout = setTimeout(() => {
      rl.close();
      logger.warn(`Approval timed out: ${approval.id}`);
      addAuditEntry(ctx, {
        type: "approval",
        approved: false,
        error: "timeout",
      });
      ctx.pendingApprovals.delete(approval.id);
      resolve({ approved: false, reason: "timeout" });
    }, ctx.config.approvals.approvalTimeoutMs);

    const askQuestion = () => {
      rl.question("Approve? [y/n/v/s]: ", (answer) => {
        const lower = answer.toLowerCase().trim();

        if (lower === "y" || lower === "yes") {
          clearTimeout(timeout);
          rl.close();
          logger.info(`Approved: ${approval.id}`);
          addAuditEntry(ctx, {
            type: "approval",
            approved: true,
            approvedBy: "user",
          });
          ctx.pendingApprovals.delete(approval.id);
          resolve({ approved: true, approvedBy: "user" });
        } else if (lower === "n" || lower === "no") {
          clearTimeout(timeout);
          rl.close();
          logger.info(`Denied: ${approval.id}`);
          addAuditEntry(ctx, {
            type: "approval",
            approved: false,
            approvedBy: "user",
          });
          ctx.pendingApprovals.delete(approval.id);
          resolve({ approved: false, reason: "user denied" });
        } else if (lower === "v" || lower === "view") {
          console.log("\nFull details:");
          console.log(JSON.stringify(approval.details, null, 2));
          console.log();
          askQuestion();
        } else if (lower === "s" || lower === "skip") {
          clearTimeout(timeout);
          rl.close();
          logger.info(`Skipped: ${approval.id}`);
          addAuditEntry(ctx, {
            type: "approval",
            approved: false,
            approvedBy: "user",
            error: "skipped",
          });
          ctx.pendingApprovals.delete(approval.id);
          resolve({ approved: false, reason: "skipped" });
        } else {
          console.log("Please enter y (yes), n (no), v (view), or s (skip)");
          askQuestion();
        }
      });
    };

    askQuestion();
  });
}

/**
 * Check if an approval should be auto-approved
 */
function shouldAutoApprove(approval: PendingApproval, ctx: RunContext): boolean {
  const patterns = ctx.config.approvals.autoApprovePatterns;
  if (patterns.length === 0) return false;

  // Get paths to check based on approval type
  let pathsToCheck: string[] = [];

  if (approval.type === "patch") {
    const details = approval.details as { paths: string[] };
    pathsToCheck = details.paths;
  } else if (approval.type === "write") {
    const details = approval.details as { path: string };
    pathsToCheck = [details.path];
  } else if (approval.type === "exec") {
    const details = approval.details as { command: string };
    pathsToCheck = [details.command];
  }

  // Check if all paths match at least one auto-approve pattern
  for (const path of pathsToCheck) {
    let matched = false;
    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern).test(path)) {
          matched = true;
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }
    if (!matched) return false;
  }

  return pathsToCheck.length > 0;
}

/**
 * Non-interactive approval check (for programmatic use)
 */
export function checkApprovalPolicy(
  type: PendingApproval["type"],
  ctx: RunContext,
): { required: boolean; reason?: string } {
  switch (type) {
    case "write":
      if (!ctx.config.approvals.requireWriteApproval) {
        return { required: false, reason: "write approval disabled" };
      }
      break;
    case "exec":
      if (!ctx.config.approvals.requireExecApproval) {
        return { required: false, reason: "exec approval disabled" };
      }
      break;
    case "patch":
      if (!ctx.config.approvals.requireWriteApproval) {
        return { required: false, reason: "write approval disabled" };
      }
      break;
  }

  return { required: true };
}
