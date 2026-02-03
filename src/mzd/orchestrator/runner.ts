/**
 * Task Runner - Executes orchestrated tasks with safety and limits
 */

import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import {
  type OrchestratorContext,
  type OrchestratorLimits,
  type StructuredOutput,
  type Checkpoint,
  type Evidence,
  createOrchestratorContext,
  checkLimits,
  incrementStep,
  recordToolCall,
  escalateMode,
  createCheckpoint,
  buildStructuredOutput,
  logEntry,
  storeArtifact,
  formatRunLog,
} from "./core.js";
import {
  type AgentTask,
  type AgentResult,
  type ChangePlannerResult,
  type RiskReviewerResult,
  runAgent,
  runAgentsParallel,
} from "./agents.js";
import { executeTool } from "../tools/executor.js";
import type { ToolName, ToolResult } from "../tools/types.js";
import { isToolError } from "../tools/types.js";

/**
 * Task definition
 */
export interface Task {
  goal: string;
  plan?: string[];
  limits?: Partial<OrchestratorLimits>;
  readOnly?: boolean;
}

/**
 * Task result - either structured output or checkpoint
 */
export type TaskResult = StructuredOutput | Checkpoint;

/**
 * Check if result is a checkpoint
 */
export function isCheckpoint(result: TaskResult): result is Checkpoint {
  return "type" in result && result.type === "checkpoint";
}

/**
 * Task runner class
 */
export class TaskRunner {
  private runCtx: RunContext;
  private logger: MzdLogger;
  private orchCtx: OrchestratorContext | null = null;

  constructor(runCtx: RunContext, logger: MzdLogger) {
    this.runCtx = runCtx;
    this.logger = logger;
  }

  /**
   * Get the current orchestrator context
   */
  getContext(): OrchestratorContext | null {
    return this.orchCtx;
  }

  /**
   * Execute a task
   */
  async execute(task: Task): Promise<TaskResult> {
    this.orchCtx = createOrchestratorContext(task.goal, task.limits);
    const ctx = this.orchCtx;

    this.logger.info(`Starting task: ${task.goal}`, { runId: ctx.runId });
    logEntry(ctx, "step", `Goal: ${task.goal}`);

    if (task.plan) {
      logEntry(ctx, "step", `Plan: ${task.plan.length} steps`);
      for (const step of task.plan) {
        logEntry(ctx, "step", `  - ${step}`);
      }
    }

    try {
      // Check limits before starting
      const limitCheck = checkLimits(ctx);
      if (limitCheck.exceeded) {
        return buildStructuredOutput(ctx, {
          status: "failure",
          tldr: [`Limits exceeded before starting: ${limitCheck.reason}`],
          findings: [],
          confidence: 0,
        });
      }

      // Execute the plan
      const result = await this.executePlan(ctx, task);

      // Store run log as artifact
      const logPath = storeArtifact(ctx, "run-log.md", formatRunLog(ctx));
      this.logger.info(`Run log stored at ${logPath}`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logEntry(ctx, "error", `Task failed: ${errorMessage}`);

      return buildStructuredOutput(ctx, {
        status: "failure",
        tldr: [`Task failed: ${errorMessage}`],
        findings: [],
        risks: [errorMessage],
        confidence: 0,
      });
    }
  }

  /**
   * Execute the plan steps
   */
  private async executePlan(ctx: OrchestratorContext, task: Task): Promise<TaskResult> {
    const findings: string[] = [];
    const evidence: Evidence[] = [];
    const risks: string[] = [];
    const nextActions: string[] = [];

    // If no explicit plan, we need to analyze and create one
    if (!task.plan || task.plan.length === 0) {
      incrementStep(ctx);

      // Use ChangePlanner agent to create a plan
      const planResult = await runAgent<ChangePlannerResult>(ctx, {
        agent: "ChangePlanner",
        input: { goal: task.goal },
      });

      if (!planResult.success) {
        return buildStructuredOutput(ctx, {
          status: "failure",
          tldr: ["Failed to create plan"],
          findings: [],
          risks: [planResult.error || "Unknown planning error"],
          confidence: 0,
        });
      }

      const planStepCount = planResult.data?.plan?.length || 0;
      findings.push(`Plan created with ${planStepCount} steps`);
    }

    // Check if this requires write operations
    const requiresWrite = this.detectWriteOperations(task);

    if (requiresWrite && task.readOnly !== false) {
      // Return checkpoint for approval
      return createCheckpoint(`Task "${task.goal}" requires write operations`, {
        risks: [
          "This task will modify files or execute commands",
          "Review the proposed changes before approving",
        ],
        verification: ["Run tests after changes", "Review git diff"],
      });
    }

    // Execute each plan step
    const planSteps = task.plan || ["Analyze", "Execute", "Verify"];

    for (let i = 0; i < planSteps.length; i++) {
      const step = planSteps[i];
      incrementStep(ctx);

      // Check limits
      const limitCheck = checkLimits(ctx);
      if (limitCheck.exceeded) {
        risks.push(limitCheck.reason || "Limits exceeded");
        break;
      }

      logEntry(ctx, "step", `Executing step ${i + 1}: ${step}`);
      findings.push(`Step ${i + 1}: ${step}`);

      // Check for complexity escalation
      if (ctx.stats.toolCallCount > 6) {
        escalateMode(ctx, { complexity: true });
      }
    }

    // Run risk review
    const riskResult = await runAgent<RiskReviewerResult>(ctx, {
      agent: "RiskReviewer",
      input: { changes: findings.join("\n"), context: task.goal },
    });

    if (riskResult.success && riskResult.data?.risks) {
      for (const risk of riskResult.data.risks) {
        risks.push(`[${risk.severity}] ${risk.category}: ${risk.description}`);
      }
    }

    // Calculate confidence based on success rate and risks
    const confidence = this.calculateConfidence(ctx, risks);

    return buildStructuredOutput(ctx, {
      status: risks.some((r) => r.includes("[critical]")) ? "failure" : "success",
      tldr: this.generateTldr(findings, risks),
      findings,
      evidence,
      nextActions,
      risks,
      confidence,
    });
  }

  /**
   * Call a tool within the orchestrator context
   */
  async callTool(name: ToolName, input: Record<string, unknown>): Promise<ToolResult<unknown>> {
    if (!this.orchCtx) {
      throw new Error("No active orchestrator context");
    }

    const ctx = this.orchCtx;

    // Check limits
    const limitCheck = checkLimits(ctx);
    if (limitCheck.exceeded) {
      return {
        error: {
          code: "LIMIT_EXCEEDED",
          message: limitCheck.reason || "Limits exceeded",
        },
      };
    }

    // Execute tool
    const startTime = Date.now();
    const result = await executeTool(name, input, this.runCtx, this.logger);
    const duration = Date.now() - startTime;

    // Record the call
    const success = !isToolError(result);
    recordToolCall(ctx, name, success);

    logEntry(ctx, "tool_call", `${name} completed in ${duration}ms`, {
      success,
      duration,
    });

    // Check for repeated failures
    if (!success) {
      const retries = ctx.stats.retriesByTool.get(name) || 0;
      if (retries >= 2) {
        escalateMode(ctx, { failures: true });
      }
    }

    return result;
  }

  /**
   * Run a sub-agent within the orchestrator context
   */
  async runSubAgent<T extends AgentResult>(task: AgentTask): Promise<T> {
    if (!this.orchCtx) {
      throw new Error("No active orchestrator context");
    }

    return runAgent<T>(this.orchCtx, task);
  }

  /**
   * Detect if task requires write operations
   */
  private detectWriteOperations(task: Task): boolean {
    const goal = task.goal.toLowerCase();
    const writeKeywords = [
      "write",
      "edit",
      "modify",
      "create",
      "delete",
      "remove",
      "update",
      "change",
      "fix",
      "patch",
      "apply",
      "commit",
      "deploy",
    ];

    return writeKeywords.some((kw) => goal.includes(kw));
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(ctx: OrchestratorContext, risks: string[]): number {
    let confidence = 1.0;

    // Reduce for tool failures
    const totalRetries = Array.from(ctx.stats.retriesByTool.values()).reduce(
      (sum, r) => sum + r,
      0,
    );
    confidence -= totalRetries * 0.1;

    // Reduce for risks
    const criticalRisks = risks.filter((r) => r.includes("[critical]")).length;
    const highRisks = risks.filter((r) => r.includes("[high]")).length;
    confidence -= criticalRisks * 0.3;
    confidence -= highRisks * 0.15;

    // Reduce if limits were close
    if (ctx.stats.stepCount >= ctx.limits.maxSteps * 0.8) {
      confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Generate TL;DR bullets
   */
  private generateTldr(findings: string[], risks: string[]): string[] {
    const tldr: string[] = [];

    // Summarize findings (max 3)
    if (findings.length > 0) {
      tldr.push(...findings.slice(0, 3));
    }

    // Add critical risks
    const criticalRisks = risks.filter((r) => r.includes("[critical]"));
    if (criticalRisks.length > 0) {
      tldr.push(`⚠️ ${criticalRisks.length} critical risk(s) identified`);
    }

    // Ensure 3-6 bullets
    while (tldr.length < 3 && findings.length > tldr.length) {
      tldr.push(findings[tldr.length]);
    }

    return tldr.slice(0, 6);
  }
}

/**
 * Create a task runner
 */
export function createTaskRunner(runCtx: RunContext, logger: MzdLogger): TaskRunner {
  return new TaskRunner(runCtx, logger);
}
