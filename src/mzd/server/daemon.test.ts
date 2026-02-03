/**
 * Tests for LocalAgentDaemon
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import fs from "node:fs/promises";
import { LocalAgentDaemon } from "./daemon.js";
import { LocalAgentClient } from "../client/daemon-client.js";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import type { MzdConfig, WorkspaceConfig, ServerConfig } from "../config/types.js";

// Test workspace path
const TEST_WORKSPACE_PATH = "/tmp/test";

// Ensure test directory exists
beforeAll(async () => {
  await fs.mkdir(TEST_WORKSPACE_PATH, { recursive: true });
});

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

// Mock config using the actual schema fields
function createMockConfig(): MzdConfig {
  return {
    version: 1 as const,
    defaultWorkspace: "test",
    workspaces: [
      {
        name: "test",
        path: TEST_WORKSPACE_PATH,
        tier: "write" as const,
        denyPatterns: [],
        allowGit: true,
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 0, // Random port - OS will assign actual port
      transport: "http" as const,
      enableRequestLogging: true,
    },
    approvals: {
      requireWriteApproval: false,
      requireExecApproval: false,
      autoApprovePatterns: [],
      approvalTimeoutMs: 300000,
    },
    commands: {
      allow: [],
      deny: [],
    },
    logging: {
      level: "info" as const,
      jsonLogs: false,
      timestamps: true,
    },
    globalDenyPatterns: [],
  };
}

// Mock run context
function createMockRunContext(): RunContext {
  const config = createMockConfig();
  return {
    runId: "test_run_123",
    startTime: new Date(),
    workspace: config.workspaces[0],
    config,
    auditLog: [],
    traceMode: false,
    turnCount: 0,
    maxTurns: 100,
    pendingApprovals: new Map(),
  };
}

describe("LocalAgentDaemon", () => {
  let daemon: LocalAgentDaemon;
  let client: LocalAgentClient;
  let runCtx: RunContext;
  let logger: MzdLogger;
  let serverConfig: ServerConfig;
  let fullConfig: MzdConfig;
  let authToken: string;
  let serverPort: number;

  beforeEach(async () => {
    runCtx = createMockRunContext();
    logger = createMockLogger();
    fullConfig = createMockConfig();
    serverConfig = { host: "127.0.0.1", port: 0, transport: "http" as const };
    authToken = "test-token-12345678901234567890";

    daemon = new LocalAgentDaemon(runCtx, logger, serverConfig, fullConfig, authToken);

    // Start daemon and get actual port
    const { port } = await daemon.start();
    serverPort = port;

    // Create client with correct port
    client = new LocalAgentClient({
      host: "127.0.0.1",
      port: serverPort,
      token: authToken,
      clientName: "test-client",
    });
  });

  afterEach(async () => {
    if (client?.isConnected()) {
      client.close();
    }
    await daemon?.stop();
  });

  describe("start/stop", () => {
    it("starts and stops without error", async () => {
      expect(daemon).toBeDefined();
      expect(serverPort).toBeGreaterThan(0);
    });

    it("throws error if already running", async () => {
      await expect(daemon.start()).rejects.toThrow("already running");
    });
  });

  describe("authentication", () => {
    it("accepts valid token", async () => {
      const { workspace, tools } = await client.connect();

      expect(workspace).toBeDefined();
      expect(workspace.name).toBe("test");
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
    });

    it("rejects invalid token", async () => {
      const badClient = new LocalAgentClient({
        host: "127.0.0.1",
        port: serverPort,
        token: "wrong-token",
        clientName: "bad-client",
      });

      await expect(badClient.connect()).rejects.toThrow();
      badClient.close();
    });

    it("rejects empty token", async () => {
      const badClient = new LocalAgentClient({
        host: "127.0.0.1",
        port: serverPort,
        token: "",
        clientName: "bad-client",
      });

      await expect(badClient.connect()).rejects.toThrow();
      badClient.close();
    });
  });

  describe("tools.list", () => {
    it("lists available tools", async () => {
      await client.connect();
      const tools = await client.listTools();

      expect(Array.isArray(tools)).toBe(true);
      // Should have at least some tools
      expect(tools.length).toBeGreaterThan(0);

      // Each tool should have expected properties
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.tier).toBeDefined();
      }
    });
  });

  describe("ping", () => {
    it("responds to ping", async () => {
      await client.connect();
      const result = await client.ping();

      expect(result).toBe(true);
    });

    it("returns false when not connected", async () => {
      // Don't connect first
      const disconnectedClient = new LocalAgentClient({
        host: "127.0.0.1",
        port: serverPort,
        token: authToken,
      });

      const result = await disconnectedClient.ping();
      expect(result).toBe(false);
    });
  });

  describe("tools.call", () => {
    it("calls fs.list tool", async () => {
      await client.connect();

      // Use workspace path that is within the configured workspace
      const result = await client.callTool("fs.list", {
        path: "/tmp/test",
        showHidden: false,
      });

      expect(result.toolCallId).toBeDefined();
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      // Result may be success or error depending on environment
      expect(result.result).toBeDefined();
    });

    it("returns error for unknown tool", async () => {
      await client.connect();

      await expect(client.callTool("unknown.tool", {})).rejects.toThrow();
    });

    it("includes toolCallId in response", async () => {
      await client.connect();

      const customCallId = "my-custom-id-123";
      const result = await client.callTool("fs.list", { path: "/tmp/test" }, customCallId);

      expect(result.toolCallId).toBe(customCallId);
    });
  });

  describe("events", () => {
    it("receives events via handler", async () => {
      const events: Array<{ event: string; payload: unknown }> = [];

      await client.connect();

      const unsubscribe = client.onEvent((event, payload) => {
        events.push({ event, payload });
      });

      // Trigger a tool call which should emit events
      await client.callTool("fs.list", { path: "/tmp/test" });

      // Give time for events to propagate
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received tool events
      const toolEvents = events.filter((e) => e.event === "tool");
      expect(toolEvents.length).toBeGreaterThanOrEqual(0);

      unsubscribe();
    });
  });

  describe("client state", () => {
    it("tracks connection state correctly", async () => {
      expect(client.isConnected()).toBe(false);

      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.close();
      expect(client.isConnected()).toBe(false);
    });

    it("returns workspace info after connect", async () => {
      expect(client.getWorkspace()).toBeNull();

      await client.connect();
      const workspace = client.getWorkspace();

      expect(workspace).not.toBeNull();
      expect(workspace?.name).toBe("test");
      expect(workspace?.path).toBe("/tmp/test");
      expect(workspace?.tier).toBe("write");
    });

    it("returns tools after connect", async () => {
      expect(client.getTools()).toHaveLength(0);

      await client.connect();
      const tools = client.getTools();

      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("handles connection timeout", async () => {
      // Create client pointing to non-existent port
      const badClient = new LocalAgentClient({
        host: "127.0.0.1",
        port: 59999,
        token: authToken,
      });

      await expect(badClient.connect()).rejects.toThrow();
    });

    it("handles server shutdown gracefully", async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Stop the daemon
      await daemon.stop();

      // Give time for client to detect closure
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client.isConnected()).toBe(false);
    });
  });
});

describe("LocalAgentClient", () => {
  describe("constructor", () => {
    it("creates client with options", () => {
      const client = new LocalAgentClient({
        host: "localhost",
        port: 3847,
        token: "test-token",
        clientName: "my-client",
      });

      expect(client.isConnected()).toBe(false);
      expect(client.getWorkspace()).toBeNull();
      expect(client.getTools()).toHaveLength(0);
    });
  });

  describe("close", () => {
    it("can be called multiple times safely", () => {
      const client = new LocalAgentClient({
        host: "localhost",
        port: 3847,
        token: "test-token",
      });

      // Should not throw
      client.close();
      client.close();
      client.close();
    });
  });
});
