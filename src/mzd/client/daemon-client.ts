/**
 * Client for connecting to the local agent daemon
 *
 * Used by OpenClaw gateway to forward tool calls to the local daemon.
 */

import WebSocket from "ws";
import crypto from "node:crypto";

/** Protocol version expected from daemon */
const EXPECTED_PROTOCOL_VERSION = 1;

/** Connection timeout (10s) */
const CONNECT_TIMEOUT_MS = 10_000;

/** Request timeout (5 minutes) */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Request frame to daemon
 */
interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Response frame from daemon
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
 * Event frame from daemon
 */
interface EventFrame {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
}

/**
 * Tool definition from daemon
 */
export interface DaemonTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tier: string;
}

/**
 * Workspace info from daemon
 */
export interface DaemonWorkspace {
  name: string;
  path: string;
  tier: string;
}

/**
 * Hello response from daemon
 */
interface HelloResponse {
  type: "hello-ok";
  protocol: number;
  server: {
    name: string;
    version: string;
  };
  workspace: DaemonWorkspace;
  tools: DaemonTool[];
  features: {
    methods: string[];
    events: string[];
  };
}

/**
 * Tool call result
 */
export interface ToolCallResult {
  toolCallId: string;
  result: unknown;
  duration_ms: number;
}

/**
 * Event handler type
 */
export type EventHandler = (event: string, payload: unknown) => void;

/**
 * Pending request
 */
interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Client for the local agent daemon
 */
export class LocalAgentClient {
  private url: string;
  private token: string;
  private clientName: string;

  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;

  private pendingRequests: Map<string, PendingRequest> = new Map();
  private eventHandlers: Set<EventHandler> = new Set();

  private workspace: DaemonWorkspace | null = null;
  private tools: DaemonTool[] = [];

  constructor(options: { host: string; port: number; token: string; clientName?: string }) {
    this.url = `ws://${options.host}:${options.port}`;
    this.token = options.token;
    this.clientName = options.clientName || "openclaw-gateway";
  }

  /**
   * Connect to the daemon
   */
  async connect(): Promise<{ workspace: DaemonWorkspace; tools: DaemonTool[] }> {
    if (this.connected) {
      throw new Error("Already connected");
    }

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new Error("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.url);

      this.ws.on("open", async () => {
        try {
          this.connected = true;

          // Authenticate
          const hello = (await this.request("connect", {
            token: this.token,
            client: {
              name: this.clientName,
              version: "1.0.0",
            },
          })) as HelloResponse;

          if (hello.protocol !== EXPECTED_PROTOCOL_VERSION) {
            throw new Error(
              `Protocol version mismatch: expected ${EXPECTED_PROTOCOL_VERSION}, got ${hello.protocol}`,
            );
          }

          this.authenticated = true;
          this.workspace = hello.workspace;
          this.tools = hello.tools;

          clearTimeout(connectTimeout);
          resolve({
            workspace: hello.workspace,
            tools: hello.tools,
          });
        } catch (error) {
          clearTimeout(connectTimeout);
          this.close();
          reject(error);
        }
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        this.handleClose();
      });

      this.ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      });
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    let frame: ResponseFrame | EventFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }

    if (frame.type === "res") {
      this.handleResponse(frame as ResponseFrame);
    } else if (frame.type === "event") {
      this.handleEvent(frame as EventFrame);
    }
  }

  /**
   * Handle response frame
   */
  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      const error = new Error(frame.error?.message || "Request failed");
      (error as Error & { code?: string }).code = frame.error?.code;
      pending.reject(error);
    }
  }

  /**
   * Handle event frame
   */
  private handleEvent(frame: EventFrame): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(frame.event, frame.payload);
      } catch {
        // Ignore handler errors
      }
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(): void {
    this.connected = false;
    this.authenticated = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Send a request and wait for response
   */
  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected");
    }

    const id = crypto.randomUUID();
    const frame: RequestFrame = { type: "req", id, method };
    if (params) frame.params = params;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify(frame), (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * List available tools
   */
  async listTools(): Promise<DaemonTool[]> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    const result = (await this.request("tools.list")) as { tools: DaemonTool[] };
    this.tools = result.tools;
    return result.tools;
  }

  /**
   * Call a tool
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    callId?: string,
  ): Promise<ToolCallResult> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    const result = (await this.request("tools.call", {
      name,
      arguments: args,
      callId,
    })) as ToolCallResult;

    return result;
  }

  /**
   * Ping the daemon
   */
  async ping(): Promise<boolean> {
    if (!this.authenticated) {
      return false;
    }

    try {
      await this.request("ping");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add an event handler
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Get workspace info
   */
  getWorkspace(): DaemonWorkspace | null {
    return this.workspace;
  }

  /**
   * Get available tools
   */
  getTools(): DaemonTool[] {
    return this.tools;
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.workspace = null;
    this.tools = [];
  }
}
