/**
 * Local Agent Daemon - WebSocket server for secure local tool execution
 *
 * This daemon exposes local filesystem, git, and command tools to OpenClaw
 * with workspace scoping, authentication, and approval gates.
 */

import { createServer, type Server, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import type { ServerConfig, MzdConfig } from "../config/types.js";
import { TOOL_DEFINITIONS, type ToolName, isToolError } from "../tools/types.js";
import { executeTool } from "../tools/executor.js";
import { addAuditEntry } from "../runtime/context.js";

/** Protocol version for the local agent daemon */
const PROTOCOL_VERSION = 1;

/** Maximum payload size (5MB) */
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** Heartbeat interval (30s) */
const TICK_INTERVAL_MS = 30_000;

/**
 * Request frame from client
 */
interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Response frame to client
 */
interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Event frame to client
 */
interface EventFrame {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
}

/**
 * Connect params for authentication
 */
interface ConnectParams {
  token: string;
  client?: {
    name?: string;
    version?: string;
  };
}

/**
 * Tool call params
 */
interface ToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
  callId?: string;
}

/**
 * Connected client state
 */
interface ConnectedClient {
  ws: WebSocket;
  authenticated: boolean;
  clientName?: string;
  connectedAt: number;
  lastActivity: number;
  eventSeq: number;
}

/**
 * Local Agent Daemon server
 */
export class LocalAgentDaemon {
  private ctx: RunContext;
  private logger: MzdLogger;
  private config: ServerConfig;
  private fullConfig: MzdConfig;
  private authToken: string;

  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    ctx: RunContext,
    logger: MzdLogger,
    config: ServerConfig,
    fullConfig: MzdConfig,
    authToken: string,
  ) {
    this.ctx = ctx;
    this.logger = logger;
    this.config = config;
    this.fullConfig = fullConfig;
    this.authToken = authToken;
  }

  /**
   * Get available tools based on workspace tier
   */
  private getAvailableTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    tier: string;
  }> {
    const tier = this.ctx.workspace.tier;
    const tierPriority: Record<string, number> = {
      read: 1,
      write: 2,
      exec: 3,
    };

    return TOOL_DEFINITIONS.filter((tool) => tierPriority[tool.tier] <= tierPriority[tier]).map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        tier: tool.tier,
      }),
    );
  }

  /**
   * Send a response frame
   */
  private sendResponse(
    ws: WebSocket,
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { code: string; message: string; details?: unknown },
  ): void {
    const frame: ResponseFrame = { type: "res", id, ok };
    if (payload !== undefined) frame.payload = payload;
    if (error) frame.error = error;

    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      this.logger.error("Failed to send response", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Send an event frame to all authenticated clients
   */
  private broadcastEvent(event: string, payload: unknown): void {
    for (const [ws, client] of this.clients) {
      if (!client.authenticated) continue;

      client.eventSeq++;
      const frame: EventFrame = {
        type: "event",
        event,
        payload,
        seq: client.eventSeq,
      };

      try {
        ws.send(JSON.stringify(frame));
      } catch (err) {
        this.logger.error("Failed to broadcast event", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Handle connect request (authentication)
   */
  private handleConnect(
    ws: WebSocket,
    client: ConnectedClient,
    id: string,
    params: ConnectParams,
  ): void {
    // Validate token with timing-safe comparison
    const providedToken = params.token || "";
    const tokenValid =
      providedToken.length === this.authToken.length &&
      crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(this.authToken));

    if (!tokenValid) {
      this.sendResponse(ws, id, false, undefined, {
        code: "AUTH_FAILED",
        message: "Invalid authentication token",
      });
      ws.close(4001, "Authentication failed");
      return;
    }

    // Mark as authenticated
    client.authenticated = true;
    client.clientName = params.client?.name;

    this.logger.info("Client authenticated", {
      clientName: client.clientName,
    });

    // Send hello response
    this.sendResponse(ws, id, true, {
      type: "hello-ok",
      protocol: PROTOCOL_VERSION,
      server: {
        name: "local-agent",
        version: "0.1.0",
      },
      workspace: {
        name: this.ctx.workspace.name,
        path: this.ctx.workspace.path,
        tier: this.ctx.workspace.tier,
      },
      tools: this.getAvailableTools(),
      features: {
        methods: ["connect", "tools.list", "tools.call", "ping"],
        events: ["tool", "approval", "tick"],
      },
    });
  }

  /**
   * Handle tools.list request
   */
  private handleToolsList(ws: WebSocket, id: string): void {
    this.sendResponse(ws, id, true, {
      tools: this.getAvailableTools(),
    });
  }

  /**
   * Handle tools.call request
   */
  private async handleToolsCall(ws: WebSocket, id: string, params: ToolCallParams): Promise<void> {
    const { name, arguments: args, callId } = params;
    const toolCallId = callId || crypto.randomUUID();

    this.logger.debug(`Tool call: ${name}`, { args, toolCallId });

    // Broadcast tool start event
    this.broadcastEvent("tool", {
      phase: "start",
      toolCallId,
      name,
      args,
    });

    const startTime = Date.now();
    let result: unknown;
    let isError = false;

    try {
      result = await executeTool(name as ToolName, args, this.ctx, this.logger);
      isError = isToolError(result);
    } catch (error) {
      isError = true;
      result = {
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const duration_ms = Date.now() - startTime;

    // Log tool call
    this.logger.tool(name, args, result, duration_ms);

    // Add to audit log
    addAuditEntry(this.ctx, {
      type: "tool_call",
      tool: name,
      input: args,
      output: result as Record<string, unknown>,
      duration_ms,
      ...(isError && { error: JSON.stringify(result) }),
    });

    // Broadcast tool result event
    this.broadcastEvent("tool", {
      phase: "result",
      toolCallId,
      name,
      result,
      isError,
      duration_ms,
    });

    // Send response
    if (isError) {
      const errorResult = result as { error: { code: string; message: string } };
      this.sendResponse(ws, id, false, undefined, {
        code: errorResult.error.code,
        message: errorResult.error.message,
      });
    } else {
      this.sendResponse(ws, id, true, {
        toolCallId,
        result,
        duration_ms,
      });
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(ws: WebSocket, client: ConnectedClient, data: string): Promise<void> {
    client.lastActivity = Date.now();

    let frame: RequestFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      this.sendResponse(ws, "unknown", false, undefined, {
        code: "PARSE_ERROR",
        message: "Invalid JSON",
      });
      return;
    }

    if (frame.type !== "req" || !frame.method || !frame.id) {
      this.sendResponse(ws, frame.id || "unknown", false, undefined, {
        code: "INVALID_REQUEST",
        message: "Invalid request frame",
      });
      return;
    }

    // Handle connect (always allowed)
    if (frame.method === "connect") {
      this.handleConnect(ws, client, frame.id, (frame.params || {}) as unknown as ConnectParams);
      return;
    }

    // All other methods require authentication
    if (!client.authenticated) {
      this.sendResponse(ws, frame.id, false, undefined, {
        code: "UNAUTHORIZED",
        message: "Authentication required. Send connect request first.",
      });
      return;
    }

    // Route to method handler
    switch (frame.method) {
      case "tools.list":
        this.handleToolsList(ws, frame.id);
        break;

      case "tools.call":
        await this.handleToolsCall(ws, frame.id, (frame.params || {}) as unknown as ToolCallParams);
        break;

      case "ping":
        this.sendResponse(ws, frame.id, true, { pong: true });
        break;

      default:
        this.sendResponse(ws, frame.id, false, undefined, {
          code: "METHOD_NOT_FOUND",
          message: `Unknown method: ${frame.method}`,
        });
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const client: ConnectedClient = {
      ws,
      authenticated: false,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      eventSeq: 0,
    };

    this.clients.set(ws, client);

    this.logger.info("Client connected", {
      remoteAddress: req.socket.remoteAddress,
    });

    ws.on("message", async (data: Buffer) => {
      const message = data.toString();

      // Check payload size
      if (message.length > MAX_PAYLOAD_BYTES) {
        this.sendResponse(ws, "unknown", false, undefined, {
          code: "PAYLOAD_TOO_LARGE",
          message: `Payload exceeds maximum size of ${MAX_PAYLOAD_BYTES} bytes`,
        });
        return;
      }

      await this.handleMessage(ws, client, message);
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      this.logger.info("Client disconnected", {
        clientName: client.clientName,
        authenticated: client.authenticated,
      });
    });

    ws.on("error", (err) => {
      this.logger.error("WebSocket error", {
        error: err.message,
        clientName: client.clientName,
      });
    });
  }

  /**
   * Start the daemon
   */
  async start(): Promise<{ host: string; port: number }> {
    if (this.running) {
      throw new Error("Daemon is already running");
    }

    return new Promise((resolve, reject) => {
      this.httpServer = createServer();

      this.wss = new WebSocketServer({
        server: this.httpServer,
        maxPayload: MAX_PAYLOAD_BYTES,
      });

      this.wss.on("connection", (ws, req) => {
        this.handleConnection(ws, req);
      });

      this.httpServer.on("error", (err) => {
        reject(err);
      });

      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.running = true;

        // Start heartbeat
        this.tickInterval = setInterval(() => {
          this.broadcastEvent("tick", { timestamp: Date.now() });
        }, TICK_INTERVAL_MS);

        this.logger.info("Local agent daemon started", {
          host: this.config.host,
          port: this.config.port,
          workspace: this.ctx.workspace.name,
          tier: this.ctx.workspace.tier,
        });

        resolve({
          host: this.config.host,
          port: this.config.port,
        });
      });
    });
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Close all client connections
    for (const [ws] of this.clients) {
      ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.logger.info("Local agent daemon stopped");
  }
}
