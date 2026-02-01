/**
 * MCP Server implementation for mzd
 *
 * Implements a JSON-RPC 2.0 server over stdio compatible with the
 * Model Context Protocol (MCP) specification.
 */

import readline from "node:readline";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import type { ServerConfig } from "../config/types.js";
import { TOOL_DEFINITIONS, type ToolName, isToolError } from "../tools/types.js";
import { executeTool } from "../tools/executor.js";
import { addAuditEntry } from "../runtime/context.js";

/**
 * JSON-RPC 2.0 request
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Tool definition
 */
interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Server for the mzd agent runner
 */
export class MzdServer {
  private ctx: RunContext;
  private logger: MzdLogger;
  private config: ServerConfig;
  private rl: readline.Interface | null = null;
  private running = false;

  constructor(ctx: RunContext, logger: MzdLogger, config: ServerConfig) {
    this.ctx = ctx;
    this.logger = logger;
    this.config = config;
  }

  /**
   * Get available tools based on workspace tier
   */
  private getAvailableTools(): McpTool[] {
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
      }),
    );
  }

  /**
   * Handle incoming JSON-RPC request
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case "initialize": {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: {
                name: "mzd",
                version: "0.1.0",
              },
              capabilities: {
                tools: {},
              },
            },
          };
        }

        case "initialized": {
          // Notification, no response needed
          return { jsonrpc: "2.0", id, result: {} };
        }

        case "tools/list": {
          const tools = this.getAvailableTools();
          return {
            jsonrpc: "2.0",
            id,
            result: { tools },
          };
        }

        case "tools/call": {
          const { name, arguments: args } = params as {
            name: string;
            arguments: Record<string, unknown>;
          };

          this.logger.debug(`Tool call: ${name}`, { args });

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

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
              isError,
            },
          };
        }

        case "ping": {
          return { jsonrpc: "2.0", id, result: {} };
        }

        default: {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
        }
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Send a JSON-RPC response
   */
  private sendResponse(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    process.stdout.write(json + "\n");
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.startStdio();
    } else if (this.config.transport === "http") {
      throw new Error("HTTP transport not yet implemented. Use stdio.");
    } else {
      throw new Error(`Unsupported transport: ${this.config.transport}`);
    }
  }

  /**
   * Start stdio transport
   */
  private async startStdio(): Promise<void> {
    this.running = true;
    this.logger.info("MCP server starting on stdio", {
      workspace: this.ctx.workspace.name,
      tier: this.ctx.workspace.tier,
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    return new Promise((resolve) => {
      this.rl!.on("line", async (line) => {
        if (!line.trim()) return;

        try {
          const request = JSON.parse(line) as JsonRpcRequest;

          // Validate JSON-RPC format
          if (request.jsonrpc !== "2.0" || !request.method) {
            this.sendResponse({
              jsonrpc: "2.0",
              id: request.id ?? null,
              error: {
                code: -32600,
                message: "Invalid Request",
              },
            });
            return;
          }

          const response = await this.handleRequest(request);
          if (request.id !== null && request.id !== undefined) {
            this.sendResponse(response);
          }
        } catch (error) {
          this.sendResponse({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32700,
              message: "Parse error",
            },
          });
        }
      });

      this.rl!.on("close", () => {
        this.running = false;
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.logger.info("MCP server stopped");
  }
}
