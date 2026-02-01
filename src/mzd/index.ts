/**
 * ModernizedAI Local Agent Runner (mzd)
 *
 * A local CLI-based agent runner that:
 * - Runs on a client device
 * - Exposes safe local capabilities via MCP
 * - Allows cloud orchestrators to request tool actions
 * - Provides transparent observability
 * - Enforces workspace scoping + approval gates
 */

export { runMzdCli } from "./cli/main.js";
export { MzdServer } from "./server/mcp-server.js";
export type { MzdConfig } from "./config/types.js";
export type { RunContext, RunId } from "./runtime/context.js";
export type { ToolResult, ToolError } from "./tools/types.js";
