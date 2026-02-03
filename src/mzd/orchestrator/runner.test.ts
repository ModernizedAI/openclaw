/**
 * Tests for orchestrator task runner
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskRunner, createTaskRunner, isCheckpoint, type Task } from "./runner.js";
import { createOrchestratorContext, type StructuredOutput, type Checkpoint } from "./core.js";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import type { MzdConfig, WorkspaceConfig } from "../config/types.js";

// Mock logger
function createMockLogger(): MzdLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    tool: vi.fn(),
    approval: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock config
function createMockConfig(): MzdConfig {
  return {
    version: 1,
    defaultWorkspace: "test",
    workspaces: [
      {
        name: "test",
        path: "/tmp/test",
        tier: "write",
        denyPaths: [],
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 3847,
      transport: "stdio",
    },
    approval: {
      mode: "prompt",
      timeout: 120,
      dangerPatterns: [],
    },
    logging: {
      level: "info",
      jsonLogs: false,
      timestamps: true,
    },
    commandAllowlist: [],
    commandDenylist: [],
  };
}

// Mock workspace
function createMockWorkspace(): WorkspaceConfig {
  return {
    name: "test",
    path: "/tmp/test",
    tier: "write",
    denyPaths: [],
  };
}

// Mock run context
function createMockRunContext(): RunContext {
  return {
    runId: "test_run_123",
    startTime: new Date(),
    workspace: createMockWorkspace(),
    config: createMockConfig(),
    auditLog: [],
    traceMode: false,
    turnCount: 0,
    maxTurns: 100,
    pendingApprovals: new Map(),
  };
}

describe("TaskRunner", () => {
  let runner: TaskRunner;
  let runCtx: RunContext;
  let logger: MzdLogger;

  beforeEach(() => {
    runCtx = createMockRunContext();
    logger = createMockLogger();
    runner = createTaskRunner(runCtx, logger);
  });

  describe("execute", () => {
    it("executes a simple read-only task", async () => {
      const task: Task = {
        goal: "Analyze codebase",
        readOnly: true,
      };

      const result = await runner.execute(task);

      expect(result).toBeDefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("returns checkpoint for write operations", async () => {
      const task: Task = {
        goal: "Fix the bug in auth module",
        // Not marking as readOnly
      };

      const result = await runner.execute(task);

      expect(isCheckpoint(result)).toBe(true);
      if (isCheckpoint(result)) {
        expect(result.type).toBe("checkpoint");
        expect(result.requiresApproval).toBe(true);
        expect(result.proposedAction).toContain("Fix the bug");
      }
    });

    it("executes task with explicit plan", async () => {
      const task: Task = {
        goal: "Review code",
        plan: ["Read files", "Analyze patterns", "Generate report"],
        readOnly: true,
      };

      const result = await runner.execute(task);

      expect(isCheckpoint(result)).toBe(false);
      const structured = result as StructuredOutput;
      expect(structured.status).toBeDefined();
      expect(structured.findings).toBeDefined();
    });

    it("respects custom limits", async () => {
      const task: Task = {
        goal: "Analyze",
        limits: {
          maxSteps: 2,
          maxToolCalls: 5,
        },
        readOnly: true,
      };

      const result = await runner.execute(task);
      const ctx = runner.getContext();

      expect(ctx?.limits.maxSteps).toBe(2);
      expect(ctx?.limits.maxToolCalls).toBe(5);
    });

    it("stores run log as artifact", async () => {
      const task: Task = {
        goal: "Test run log",
        readOnly: true,
      };

      await runner.execute(task);
      const ctx = runner.getContext();

      expect(ctx?.artifacts.size).toBeGreaterThan(0);
      const hasRunLog = Array.from(ctx?.artifacts.keys() || []).some((k) =>
        k.includes("run-log.md"),
      );
      expect(hasRunLog).toBe(true);
    });

    it("handles failures gracefully", async () => {
      // Create a task that will fail due to limits
      const task: Task = {
        goal: "Test",
        limits: { maxSteps: 0 },
        readOnly: true,
      };

      const result = await runner.execute(task);

      expect(isCheckpoint(result)).toBe(false);
      const structured = result as StructuredOutput;
      expect(structured.status).toBe("failure");
      expect(structured.tldr[0]).toContain("Limits exceeded");
    });
  });

  describe("getContext", () => {
    it("returns null before execute", () => {
      expect(runner.getContext()).toBeNull();
    });

    it("returns context after execute", async () => {
      await runner.execute({ goal: "Test", readOnly: true });
      expect(runner.getContext()).not.toBeNull();
    });
  });

  describe("detectWriteOperations", () => {
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

    for (const keyword of writeKeywords) {
      it(`detects "${keyword}" as write operation`, async () => {
        const task: Task = {
          goal: `${keyword} the configuration file`,
        };

        const result = await runner.execute(task);
        expect(isCheckpoint(result)).toBe(true);
      });
    }

    it("allows read operations without checkpoint", async () => {
      const task: Task = {
        goal: "read the configuration file",
        readOnly: true,
      };

      const result = await runner.execute(task);
      expect(isCheckpoint(result)).toBe(false);
    });
  });
});

describe("isCheckpoint", () => {
  it("returns true for checkpoint objects", () => {
    const checkpoint: Checkpoint = {
      type: "checkpoint",
      proposedAction: "Deploy",
      risks: [],
      verification: [],
      requiresApproval: true,
    };

    expect(isCheckpoint(checkpoint)).toBe(true);
  });

  it("returns false for structured output", () => {
    const output: StructuredOutput = {
      runId: "123",
      status: "success",
      tldr: [],
      findings: [],
      evidence: [],
      nextActions: [],
      risks: [],
      artifactPaths: [],
      confidence: 1,
      stats: {
        steps: 0,
        toolCalls: 0,
        durationMs: 0,
        modelMode: "cheap",
      },
    };

    expect(isCheckpoint(output)).toBe(false);
  });
});

describe("createTaskRunner", () => {
  it("creates a new TaskRunner instance", () => {
    const runCtx = createMockRunContext();
    const logger = createMockLogger();

    const runner = createTaskRunner(runCtx, logger);

    expect(runner).toBeInstanceOf(TaskRunner);
  });
});
