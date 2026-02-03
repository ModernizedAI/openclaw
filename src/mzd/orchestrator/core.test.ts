/**
 * Tests for orchestrator core functions
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createOrchestratorContext,
  checkLimits,
  incrementStep,
  recordToolCall,
  hasExceededRetries,
  determineModelMode,
  escalateMode,
  createCheckpoint,
  buildStructuredOutput,
  truncateOutput,
  storeArtifact,
  logEntry,
  formatRunLog,
  DEFAULT_LIMITS,
  type OrchestratorContext,
} from "./core.js";

describe("orchestrator core", () => {
  describe("createOrchestratorContext", () => {
    it("creates context with default limits", () => {
      const ctx = createOrchestratorContext("Test goal");

      expect(ctx.goal).toBe("Test goal");
      expect(ctx.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(ctx.limits).toEqual(DEFAULT_LIMITS);
      expect(ctx.stats.stepCount).toBe(0);
      expect(ctx.stats.toolCallCount).toBe(0);
      expect(ctx.stats.modelMode).toBe("cheap");
      expect(ctx.artifacts.size).toBe(0);
      expect(ctx.log.length).toBe(0);
    });

    it("creates context with custom limits", () => {
      const ctx = createOrchestratorContext("Test goal", {
        maxSteps: 5,
        maxToolCalls: 10,
      });

      expect(ctx.limits.maxSteps).toBe(5);
      expect(ctx.limits.maxToolCalls).toBe(10);
      expect(ctx.limits.maxRetriesPerTool).toBe(DEFAULT_LIMITS.maxRetriesPerTool);
    });
  });

  describe("checkLimits", () => {
    let ctx: OrchestratorContext;

    beforeEach(() => {
      ctx = createOrchestratorContext("Test", { maxSteps: 3, maxToolCalls: 5 });
    });

    it("returns not exceeded when within limits", () => {
      const result = checkLimits(ctx);
      expect(result.exceeded).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it("returns exceeded when max steps reached", () => {
      ctx.stats.stepCount = 3;
      const result = checkLimits(ctx);
      expect(result.exceeded).toBe(true);
      expect(result.reason).toContain("Max steps");
    });

    it("returns exceeded when max tool calls reached", () => {
      ctx.stats.toolCallCount = 5;
      const result = checkLimits(ctx);
      expect(result.exceeded).toBe(true);
      expect(result.reason).toContain("Max tool calls");
    });
  });

  describe("incrementStep", () => {
    it("increments step count and logs", () => {
      const ctx = createOrchestratorContext("Test");

      incrementStep(ctx);
      expect(ctx.stats.stepCount).toBe(1);
      expect(ctx.log.length).toBe(1);
      expect(ctx.log[0].type).toBe("step");
      expect(ctx.log[0].message).toBe("Step 1");

      incrementStep(ctx);
      expect(ctx.stats.stepCount).toBe(2);
      expect(ctx.log[1].message).toBe("Step 2");
    });
  });

  describe("recordToolCall", () => {
    let ctx: OrchestratorContext;

    beforeEach(() => {
      ctx = createOrchestratorContext("Test", { maxRetriesPerTool: 2 });
    });

    it("records successful tool call", () => {
      recordToolCall(ctx, "test_tool", true);

      expect(ctx.stats.toolCallCount).toBe(1);
      expect(ctx.stats.retriesByTool.get("test_tool")).toBeUndefined();
      expect(ctx.log.length).toBe(1);
      expect(ctx.log[0].type).toBe("tool_call");
    });

    it("records failed tool call and increments retries", () => {
      recordToolCall(ctx, "test_tool", false);

      expect(ctx.stats.toolCallCount).toBe(1);
      expect(ctx.stats.retriesByTool.get("test_tool")).toBe(1);
    });

    it("logs error when retries exceeded", () => {
      recordToolCall(ctx, "test_tool", false);
      recordToolCall(ctx, "test_tool", false);
      recordToolCall(ctx, "test_tool", false);

      expect(ctx.stats.retriesByTool.get("test_tool")).toBe(3);
      // Should have an error log entry
      const errorLogs = ctx.log.filter((e) => e.type === "error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0].message).toContain("exceeded max retries");
    });
  });

  describe("hasExceededRetries", () => {
    it("returns false when no retries", () => {
      const ctx = createOrchestratorContext("Test", { maxRetriesPerTool: 2 });
      expect(hasExceededRetries(ctx, "test_tool")).toBe(false);
    });

    it("returns false when retries within limit", () => {
      const ctx = createOrchestratorContext("Test", { maxRetriesPerTool: 2 });
      ctx.stats.retriesByTool.set("test_tool", 1);
      expect(hasExceededRetries(ctx, "test_tool")).toBe(false);
    });

    it("returns true when retries at limit", () => {
      const ctx = createOrchestratorContext("Test", { maxRetriesPerTool: 2 });
      ctx.stats.retriesByTool.set("test_tool", 2);
      expect(hasExceededRetries(ctx, "test_tool")).toBe(true);
    });

    it("returns true when retries above limit", () => {
      const ctx = createOrchestratorContext("Test", { maxRetriesPerTool: 2 });
      ctx.stats.retriesByTool.set("test_tool", 3);
      expect(hasExceededRetries(ctx, "test_tool")).toBe(true);
    });
  });

  describe("determineModelMode", () => {
    it("returns cheap mode when no triggers", () => {
      const result = determineModelMode({});
      expect(result.mode).toBe("cheap");
      expect(result.reasons).toHaveLength(0);
    });

    it("returns premium mode for high stakes", () => {
      const result = determineModelMode({ highStakes: true });
      expect(result.mode).toBe("premium");
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain("high_stakes");
    });

    it("returns premium mode for ambiguity", () => {
      const result = determineModelMode({ ambiguity: true });
      expect(result.mode).toBe("premium");
      expect(result.reasons[0]).toContain("ambiguity");
    });

    it("returns premium mode for failures", () => {
      const result = determineModelMode({ failures: true });
      expect(result.mode).toBe("premium");
      expect(result.reasons[0]).toContain("failures");
    });

    it("returns premium mode for complexity", () => {
      const result = determineModelMode({ complexity: true });
      expect(result.mode).toBe("premium");
      expect(result.reasons[0]).toContain("complexity");
    });

    it("returns premium mode for final output", () => {
      const result = determineModelMode({ finalOutput: true });
      expect(result.mode).toBe("premium");
      expect(result.reasons[0]).toContain("final_output");
    });

    it("accumulates multiple reasons", () => {
      const result = determineModelMode({
        highStakes: true,
        complexity: true,
        failures: true,
      });
      expect(result.mode).toBe("premium");
      expect(result.reasons).toHaveLength(3);
    });
  });

  describe("escalateMode", () => {
    it("does nothing when no triggers", () => {
      const ctx = createOrchestratorContext("Test");
      escalateMode(ctx, {});

      expect(ctx.stats.modelMode).toBe("cheap");
      expect(ctx.stats.escalationReasons).toHaveLength(0);
    });

    it("escalates to premium when triggered", () => {
      const ctx = createOrchestratorContext("Test");
      escalateMode(ctx, { highStakes: true });

      expect(ctx.stats.modelMode).toBe("premium");
      expect(ctx.stats.escalationReasons).toHaveLength(1);
      expect(ctx.log.some((e) => e.type === "escalation")).toBe(true);
    });

    it("does not re-escalate when already premium", () => {
      const ctx = createOrchestratorContext("Test");
      ctx.stats.modelMode = "premium";
      ctx.stats.escalationReasons = ["previous reason"];

      escalateMode(ctx, { complexity: true });

      // Should not add new reason since already premium
      expect(ctx.stats.escalationReasons).toHaveLength(1);
    });
  });

  describe("createCheckpoint", () => {
    it("creates checkpoint with minimal options", () => {
      const checkpoint = createCheckpoint("Apply database migration");

      expect(checkpoint.type).toBe("checkpoint");
      expect(checkpoint.proposedAction).toBe("Apply database migration");
      expect(checkpoint.requiresApproval).toBe(true);
      expect(checkpoint.risks).toEqual([]);
      expect(checkpoint.verification).toEqual([]);
    });

    it("creates checkpoint with full options", () => {
      const checkpoint = createCheckpoint("Deploy to production", {
        commands: ["kubectl apply -f deploy.yaml"],
        diff: "--- old\n+++ new",
        risks: ["Possible downtime"],
        verification: ["Check health endpoint"],
      });

      expect(checkpoint.commands).toEqual(["kubectl apply -f deploy.yaml"]);
      expect(checkpoint.diff).toBe("--- old\n+++ new");
      expect(checkpoint.risks).toEqual(["Possible downtime"]);
      expect(checkpoint.verification).toEqual(["Check health endpoint"]);
    });
  });

  describe("buildStructuredOutput", () => {
    it("builds output from context and result", () => {
      const ctx = createOrchestratorContext("Test goal");
      ctx.stats.stepCount = 3;
      ctx.stats.toolCallCount = 5;
      storeArtifact(ctx, "report.md", "# Report");

      const output = buildStructuredOutput(ctx, {
        status: "success",
        tldr: ["Task completed"],
        findings: ["Found bug in auth"],
        evidence: [{ source: "file.ts", excerpt: "bug here", relevance: "high" }],
        nextActions: ["Fix bug"],
        risks: ["Low risk"],
        confidence: 0.95,
      });

      expect(output.runId).toBe(ctx.runId);
      expect(output.status).toBe("success");
      expect(output.tldr).toEqual(["Task completed"]);
      expect(output.findings).toEqual(["Found bug in auth"]);
      expect(output.evidence).toHaveLength(1);
      expect(output.nextActions).toEqual(["Fix bug"]);
      expect(output.risks).toEqual(["Low risk"]);
      expect(output.artifactPaths).toHaveLength(1);
      expect(output.confidence).toBe(0.95);
      expect(output.stats.steps).toBe(3);
      expect(output.stats.toolCalls).toBe(5);
      expect(output.stats.modelMode).toBe("cheap");
    });

    it("uses empty arrays for optional fields", () => {
      const ctx = createOrchestratorContext("Test");

      const output = buildStructuredOutput(ctx, {
        status: "failure",
        tldr: ["Failed"],
        findings: [],
        confidence: 0,
      });

      expect(output.evidence).toEqual([]);
      expect(output.nextActions).toEqual([]);
      expect(output.risks).toEqual([]);
    });
  });

  describe("truncateOutput", () => {
    it("returns output unchanged when within limit", () => {
      const output = "Short output";
      expect(truncateOutput(output, 1000)).toBe(output);
    });

    it("truncates output when exceeding limit", () => {
      const output = "A".repeat(1000);
      const result = truncateOutput(output, 100);

      expect(Buffer.byteLength(result)).toBeLessThanOrEqual(100);
      expect(result).toContain("[TRUNCATED]");
    });

    it("handles multi-byte characters correctly", () => {
      const output = "🎉".repeat(100); // Each emoji is 4 bytes
      const result = truncateOutput(output, 50);

      expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50);
    });
  });

  describe("storeArtifact", () => {
    it("stores artifact and returns path", () => {
      const ctx = createOrchestratorContext("Test");
      const path = storeArtifact(ctx, "output.json", '{"data": true}');

      expect(path).toBe(`artifacts/${ctx.runId}/output.json`);
      expect(ctx.artifacts.get(path)).toBe('{"data": true}');
    });
  });

  describe("logEntry", () => {
    it("adds entry to log", () => {
      const ctx = createOrchestratorContext("Test");
      logEntry(ctx, "step", "Test message", { key: "value" });

      expect(ctx.log).toHaveLength(1);
      expect(ctx.log[0].type).toBe("step");
      expect(ctx.log[0].message).toBe("Test message");
      expect(ctx.log[0].data).toEqual({ key: "value" });
      expect(ctx.log[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe("formatRunLog", () => {
    it("formats log as markdown", () => {
      const ctx = createOrchestratorContext("Test goal");
      logEntry(ctx, "step", "Step 1");
      logEntry(ctx, "tool_call", "Called tool", { tool: "test" });

      const log = formatRunLog(ctx);

      expect(log).toContain("# Run Log:");
      expect(log).toContain("**Goal:** Test goal");
      expect(log).toContain("**Steps:**");
      expect(log).toContain("**Tool Calls:**");
      expect(log).toContain("[step] Step 1");
      expect(log).toContain("[tool_call] Called tool");
    });
  });
});
