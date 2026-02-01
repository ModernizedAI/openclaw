/**
 * ModernizedAI Local Agent Runner (mzd)
 *
 * A local agent daemon that:
 * - Runs on a client device
 * - Exposes safe local capabilities via WebSocket
 * - Allows OpenClaw to request tool actions securely
 * - Provides transparent observability
 * - Enforces workspace scoping + approval gates
 * - Uses token-based authentication
 */

// CLI
export { runMzdCli } from "./cli/main.js";

// Daemon server
export { LocalAgentDaemon } from "./server/daemon.js";

// Client for connecting to daemon
export {
  LocalAgentClient,
  type DaemonTool,
  type DaemonWorkspace,
  type ToolCallResult,
} from "./client/daemon-client.js";

// Auth
export {
  getOrCreateToken,
  loadToken,
  saveToken,
  regenerateToken,
  getTokenPath,
} from "./auth/token.js";

// Config types
export type { MzdConfig, WorkspaceConfig, PermissionTier } from "./config/types.js";

// Runtime types
export type { RunContext, RunId } from "./runtime/context.js";

// Tool types
export type { ToolResult, ToolError, ToolName } from "./tools/types.js";
