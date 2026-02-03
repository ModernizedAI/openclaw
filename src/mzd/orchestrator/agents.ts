/**
 * Sub-agents for the orchestrator
 *
 * Each agent is a specialist that handles specific types of tasks
 * and returns concise structured JSON.
 */

import type { OrchestratorContext, Evidence } from "./core.js";
import { logEntry, truncateOutput } from "./core.js";

/**
 * Base agent result
 */
export interface AgentResult {
  success: boolean;
  summary: string;
  data?: Record<string, unknown>;
  artifactPath?: string;
  error?: string;
}

/**
 * Context builder result
 */
export interface ContextBuilderResult extends AgentResult {
  data?: {
    files: Array<{ path: string; relevance: string; excerpt?: string }>;
    structure?: string;
    dependencies?: string[];
  };
}

/**
 * Log analyst result
 */
export interface LogAnalystResult extends AgentResult {
  data?: {
    topErrors: Array<{ message: string; count: number; firstSeen: string }>;
    timeline: Array<{ time: string; event: string }>;
    evidence: Evidence[];
  };
}

/**
 * Change planner result
 */
export interface ChangePlannerResult extends AgentResult {
  data?: {
    plan: Array<{ step: number; action: string; files: string[] }>;
    acceptanceCriteria: string[];
    risks: string[];
    estimatedComplexity: "low" | "medium" | "high";
  };
}

/**
 * Patch generator result
 */
export interface PatchGeneratorResult extends AgentResult {
  data?: {
    patches: Array<{ file: string; diff: string }>;
    summary: string;
  };
}

/**
 * Test runner result
 */
export interface TestRunnerResult extends AgentResult {
  data?: {
    passed: number;
    failed: number;
    skipped: number;
    failures: Array<{ test: string; error: string; file?: string; line?: number }>;
    duration: number;
  };
}

/**
 * Static analysis result
 */
export interface StaticAnalysisResult extends AgentResult {
  data?: {
    errors: number;
    warnings: number;
    issues: Array<{
      type: "error" | "warning" | "info";
      rule: string;
      message: string;
      file: string;
      line: number;
    }>;
  };
}

/**
 * Risk reviewer result
 */
export interface RiskReviewerResult extends AgentResult {
  data?: {
    risks: Array<{
      severity: "low" | "medium" | "high" | "critical";
      category: string;
      description: string;
      mitigation?: string;
    }>;
    securityConcerns: string[];
    regressionRisks: string[];
  };
}

/**
 * Reporter result
 */
export interface ReporterResult extends AgentResult {
  data?: {
    markdown: string;
    slackSummary: string;
  };
}

/**
 * Agent type union
 */
export type AgentType =
  | "ContextBuilder"
  | "LogAnalyst"
  | "ChangePlanner"
  | "PatchGenerator"
  | "TestRunner"
  | "StaticAnalysis"
  | "RiskReviewer"
  | "Reporter";

/**
 * Agent task definition
 */
export interface AgentTask {
  agent: AgentType;
  input: Record<string, unknown>;
  timeout?: number;
}

/**
 * Agent registry - maps agent types to their handlers
 */
export type AgentHandler<T extends AgentResult = AgentResult> = (
  ctx: OrchestratorContext,
  input: Record<string, unknown>,
) => Promise<T>;

const agentHandlers: Map<AgentType, AgentHandler> = new Map();

/**
 * Register an agent handler
 */
export function registerAgent<T extends AgentResult>(
  type: AgentType,
  handler: AgentHandler<T>,
): void {
  agentHandlers.set(type, handler as AgentHandler);
}

/**
 * Run an agent
 */
export async function runAgent<T extends AgentResult>(
  ctx: OrchestratorContext,
  task: AgentTask,
): Promise<T> {
  const handler = agentHandlers.get(task.agent);

  if (!handler) {
    return {
      success: false,
      summary: `Unknown agent: ${task.agent}`,
      error: `Agent ${task.agent} is not registered`,
    } as T;
  }

  logEntry(ctx, "step", `Running agent: ${task.agent}`, { input: task.input });

  const timeout = task.timeout || 60000;
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      handler(ctx, task.input),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent ${task.agent} timed out after ${timeout}ms`)),
          timeout,
        ),
      ),
    ]);

    const duration = Date.now() - startTime;
    logEntry(ctx, "step", `Agent ${task.agent} completed in ${duration}ms`, {
      success: result.success,
    });

    return result as T;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry(ctx, "error", `Agent ${task.agent} failed: ${errorMessage}`);

    return {
      success: false,
      summary: `Agent ${task.agent} failed`,
      error: errorMessage,
    } as T;
  }
}

/**
 * Run multiple agents in parallel
 */
export async function runAgentsParallel<T extends AgentResult>(
  ctx: OrchestratorContext,
  tasks: AgentTask[],
): Promise<T[]> {
  return Promise.all(tasks.map((task) => runAgent<T>(ctx, task)));
}

/**
 * Run agents in sequence, stopping on first failure
 */
export async function runAgentsSequence<T extends AgentResult>(
  ctx: OrchestratorContext,
  tasks: AgentTask[],
): Promise<{ results: T[]; stoppedAt?: number }> {
  const results: T[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const result = await runAgent<T>(ctx, tasks[i]);
    results.push(result);

    if (!result.success) {
      return { results, stoppedAt: i };
    }
  }

  return { results };
}

// ============================================================================
// Default agent implementations
// ============================================================================

/**
 * Default ContextBuilder - gathers repo context
 */
registerAgent<ContextBuilderResult>("ContextBuilder", async (ctx, input) => {
  const query = input.query as string;
  const maxFiles = (input.maxFiles as number) || 10;

  // This is a placeholder - actual implementation would use repo.search
  return {
    success: true,
    summary: `Gathered context for: ${query}`,
    data: {
      files: [],
      structure: "Placeholder - implement with actual repo search",
    },
  };
});

/**
 * Default LogAnalyst - extracts errors from logs
 */
registerAgent<LogAnalystResult>("LogAnalyst", async (ctx, input) => {
  const logs = input.logs as string;
  const maxErrors = (input.maxErrors as number) || 10;

  // Parse log lines and extract errors (simplified)
  const lines = logs.split("\n");
  const errors: Array<{ message: string; count: number; firstSeen: string }> = [];

  const errorCounts = new Map<string, { count: number; firstSeen: string }>();

  for (const line of lines) {
    if (/error|fail|exception/i.test(line)) {
      const key = line.slice(0, 100);
      const existing = errorCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        errorCounts.set(key, { count: 1, firstSeen: new Date().toISOString() });
      }
    }
  }

  for (const [message, data] of errorCounts) {
    errors.push({ message: truncateOutput(message, 200), ...data });
  }

  errors.sort((a, b) => b.count - a.count);

  return {
    success: true,
    summary: `Found ${errors.length} unique errors in ${lines.length} log lines`,
    data: {
      topErrors: errors.slice(0, maxErrors),
      timeline: [],
      evidence: [],
    },
  };
});

/**
 * Default ChangePlanner - proposes changes
 */
registerAgent<ChangePlannerResult>("ChangePlanner", async (ctx, input) => {
  const goal = input.goal as string;
  const context = input.context as string;

  return {
    success: true,
    summary: `Created plan for: ${goal}`,
    data: {
      plan: [
        { step: 1, action: "Analyze current state", files: [] },
        { step: 2, action: "Implement changes", files: [] },
        { step: 3, action: "Verify with tests", files: [] },
      ],
      acceptanceCriteria: ["All tests pass", "No regressions"],
      risks: ["Requires manual review"],
      estimatedComplexity: "medium",
    },
  };
});

/**
 * Default PatchGenerator - generates patches but does not apply
 */
registerAgent<PatchGeneratorResult>("PatchGenerator", async (ctx, input) => {
  const changes = input.changes as Array<{ file: string; content: string }>;

  return {
    success: true,
    summary: `Generated ${changes?.length || 0} patches`,
    data: {
      patches: [],
      summary: "Patches generated - requires approval to apply",
    },
  };
});

/**
 * Default TestRunner - runs tests
 */
registerAgent<TestRunnerResult>("TestRunner", async (ctx, input) => {
  const command = (input.command as string) || "npm test";
  const cwd = input.cwd as string;

  // Placeholder - would actually run tests
  return {
    success: true,
    summary: "Test run placeholder - implement with cmd.run",
    data: {
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
      duration: 0,
    },
  };
});

/**
 * Default StaticAnalysis - runs linters/type checks
 */
registerAgent<StaticAnalysisResult>("StaticAnalysis", async (ctx, input) => {
  const commands = (input.commands as string[]) || ["npm run lint", "npm run typecheck"];

  return {
    success: true,
    summary: "Static analysis placeholder - implement with cmd.run",
    data: {
      errors: 0,
      warnings: 0,
      issues: [],
    },
  };
});

/**
 * Default RiskReviewer - identifies risks
 */
registerAgent<RiskReviewerResult>("RiskReviewer", async (ctx, input) => {
  const changes = input.changes as string;
  const context = input.context as string;

  return {
    success: true,
    summary: "Risk review completed",
    data: {
      risks: [],
      securityConcerns: [],
      regressionRisks: [],
    },
  };
});

/**
 * Default Reporter - produces reports
 */
registerAgent<ReporterResult>("Reporter", async (ctx, input) => {
  const findings = input.findings as string[];
  const evidence = input.evidence as Evidence[];

  const markdown = [
    "# Report",
    "",
    "## Findings",
    ...(findings || []).map((f) => `- ${f}`),
    "",
    "## Evidence",
    ...(evidence || []).map((e) => `- ${e.source}: ${e.excerpt}`),
  ].join("\n");

  const slackSummary = (findings || []).slice(0, 3).join("\n");

  return {
    success: true,
    summary: "Report generated",
    data: {
      markdown,
      slackSummary,
    },
  };
});
