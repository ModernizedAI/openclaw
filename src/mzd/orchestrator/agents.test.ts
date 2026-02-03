/**
 * Tests for orchestrator agents
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerAgent,
  runAgent,
  runAgentsParallel,
  runAgentsSequence,
  type AgentResult,
  type AgentHandler,
} from "./agents.js";
import { createOrchestratorContext, type OrchestratorContext } from "./core.js";

describe("orchestrator agents", () => {
  let ctx: OrchestratorContext;

  beforeEach(() => {
    ctx = createOrchestratorContext("Test goal");
  });

  describe("runAgent", () => {
    it("returns error for unknown agent", async () => {
      const result = await runAgent(ctx, {
        agent: "UnknownAgent" as "ContextBuilder",
        input: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not registered");
    });

    it("runs ContextBuilder agent", async () => {
      const result = await runAgent(ctx, {
        agent: "ContextBuilder",
        input: { query: "test query", maxFiles: 5 },
      });

      expect(result.success).toBe(true);
      expect(result.summary).toContain("test query");
    });

    it("runs LogAnalyst agent with logs", async () => {
      const logs = `
        2024-01-01 Error: connection failed
        2024-01-01 Info: retry
        2024-01-02 Error: connection failed
        2024-01-02 Exception: timeout
      `;

      const result = await runAgent(ctx, {
        agent: "LogAnalyst",
        input: { logs, maxErrors: 3 },
      });

      expect(result.success).toBe(true);
      expect(result.data?.topErrors).toBeDefined();
    });

    it("runs ChangePlanner agent", async () => {
      const result = await runAgent(ctx, {
        agent: "ChangePlanner",
        input: { goal: "Add feature", context: "existing codebase" },
      });

      expect(result.success).toBe(true);
      expect(result.data?.plan).toBeDefined();
      expect(result.data?.acceptanceCriteria).toBeDefined();
    });

    it("runs PatchGenerator agent", async () => {
      const result = await runAgent(ctx, {
        agent: "PatchGenerator",
        input: { changes: [{ file: "test.ts", content: "new content" }] },
      });

      expect(result.success).toBe(true);
      expect(result.data?.patches).toBeDefined();
    });

    it("runs TestRunner agent", async () => {
      const result = await runAgent(ctx, {
        agent: "TestRunner",
        input: { command: "npm test", cwd: "/tmp" },
      });

      expect(result.success).toBe(true);
      expect(result.data?.passed).toBeDefined();
      expect(result.data?.failed).toBeDefined();
    });

    it("runs StaticAnalysis agent", async () => {
      const result = await runAgent(ctx, {
        agent: "StaticAnalysis",
        input: { commands: ["npm run lint"] },
      });

      expect(result.success).toBe(true);
      expect(result.data?.errors).toBeDefined();
      expect(result.data?.warnings).toBeDefined();
    });

    it("runs RiskReviewer agent", async () => {
      const result = await runAgent(ctx, {
        agent: "RiskReviewer",
        input: { changes: "diff content", context: "security update" },
      });

      expect(result.success).toBe(true);
      expect(result.data?.risks).toBeDefined();
      expect(result.data?.securityConcerns).toBeDefined();
    });

    it("runs Reporter agent", async () => {
      const result = await runAgent(ctx, {
        agent: "Reporter",
        input: {
          findings: ["Bug found", "Performance issue"],
          evidence: [{ source: "file.ts", excerpt: "code", relevance: "high" }],
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.markdown).toContain("# Report");
      expect(result.data?.slackSummary).toBeDefined();
    });

    it("logs agent execution", async () => {
      await runAgent(ctx, {
        agent: "ContextBuilder",
        input: { query: "test" },
      });

      const logs = ctx.log.filter((e) => e.type === "step");
      expect(logs.some((l) => l.message.includes("Running agent"))).toBe(true);
      expect(logs.some((l) => l.message.includes("completed"))).toBe(true);
    });

    it("handles agent timeout", async () => {
      // Register a slow agent for testing
      registerAgent("ContextBuilder", async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { success: true, summary: "done" };
      });

      const result = await runAgent(ctx, {
        agent: "ContextBuilder",
        input: {},
        timeout: 50, // 50ms timeout
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("handles agent errors", async () => {
      registerAgent("ContextBuilder", async () => {
        throw new Error("Agent crashed");
      });

      const result = await runAgent(ctx, {
        agent: "ContextBuilder",
        input: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Agent crashed");
    });
  });

  describe("runAgentsParallel", () => {
    beforeEach(() => {
      // Reset to default implementations after previous tests may have modified them
      registerAgent("ContextBuilder", async (ctx, input) => ({
        success: true,
        summary: `Gathered context for: ${input.query}`,
      }));
      registerAgent("RiskReviewer", async () => ({
        success: true,
        summary: "Risk review completed",
      }));
      registerAgent("Reporter", async () => ({
        success: true,
        summary: "Report generated",
      }));
    });

    it("runs multiple agents in parallel", async () => {
      const results = await runAgentsParallel(ctx, [
        { agent: "ContextBuilder", input: { query: "a" } },
        { agent: "RiskReviewer", input: { changes: "b" } },
        { agent: "Reporter", input: { findings: ["c"] } },
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("returns all results even if some fail", async () => {
      // Register a failing agent
      registerAgent("ContextBuilder", async () => {
        throw new Error("Failed");
      });

      const results = await runAgentsParallel(ctx, [
        { agent: "ContextBuilder", input: {} },
        { agent: "Reporter", input: { findings: [] } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
    });
  });

  describe("runAgentsSequence", () => {
    beforeEach(() => {
      // Reset to default implementations
      registerAgent("ContextBuilder", async (ctx, input) => ({
        success: true,
        summary: `Gathered context for: ${input.query}`,
      }));
      registerAgent("RiskReviewer", async () => ({
        success: true,
        summary: "Risk review completed",
      }));
      registerAgent("Reporter", async () => ({
        success: true,
        summary: "Report generated",
      }));
    });

    it("runs agents in sequence", async () => {
      const { results, stoppedAt } = await runAgentsSequence(ctx, [
        { agent: "ContextBuilder", input: { query: "first" } },
        { agent: "RiskReviewer", input: {} },
        { agent: "Reporter", input: { findings: [] } },
      ]);

      expect(results).toHaveLength(3);
      expect(stoppedAt).toBeUndefined();
    });

    it("stops on first failure", async () => {
      registerAgent("RiskReviewer", async () => ({
        success: false,
        summary: "Failed",
        error: "Risk too high",
      }));

      const { results, stoppedAt } = await runAgentsSequence(ctx, [
        { agent: "ContextBuilder", input: { query: "first" } },
        { agent: "RiskReviewer", input: {} },
        { agent: "Reporter", input: { findings: [] } },
      ]);

      expect(results).toHaveLength(2);
      expect(stoppedAt).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe("registerAgent", () => {
    it("registers custom agent handler", async () => {
      const customHandler: AgentHandler = async (ctx, input) => ({
        success: true,
        summary: `Custom: ${input.message}`,
        data: { custom: true },
      });

      registerAgent("ContextBuilder", customHandler);

      const result = await runAgent(ctx, {
        agent: "ContextBuilder",
        input: { message: "hello" },
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Custom: hello");
      expect(result.data).toEqual({ custom: true });
    });
  });
});
