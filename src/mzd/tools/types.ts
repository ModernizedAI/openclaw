/**
 * Tool types and contracts for the MCP server
 */

/**
 * Standard error codes
 */
export enum ToolErrorCode {
  FORBIDDEN_PATH = "FORBIDDEN_PATH",
  WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",
  PATH_NOT_FOUND = "PATH_NOT_FOUND",
  INVALID_PATH = "INVALID_PATH",
  COMMAND_DENIED = "COMMAND_DENIED",
  APPROVAL_REQUIRED = "APPROVAL_REQUIRED",
  APPROVAL_DENIED = "APPROVAL_DENIED",
  APPROVAL_TIMEOUT = "APPROVAL_TIMEOUT",
  PATCH_FAILED = "PATCH_FAILED",
  GIT_ERROR = "GIT_ERROR",
  COMMAND_FAILED = "COMMAND_FAILED",
  COMMAND_TIMEOUT = "COMMAND_TIMEOUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Structured tool error
 */
export interface ToolError {
  error: {
    code: ToolErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Tool result type - either success or error
 */
export type ToolResult<T> = T | ToolError;

/**
 * Check if result is an error
 */
export function isToolError<T>(result: ToolResult<T>): result is ToolError {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as ToolError).error === "object"
  );
}

/**
 * Create a tool error
 */
export function createToolError(
  code: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

// ============================================================
// fs.list types
// ============================================================

export interface FsListInput {
  workspace: string;
  path: string;
  recursive?: boolean;
  maxDepth?: number;
}

export interface FsListEntry {
  path: string;
  type: "file" | "dir" | "symlink";
  size?: number;
  modified?: string;
}

export interface FsListOutput {
  entries: FsListEntry[];
  truncated?: boolean;
}

// ============================================================
// fs.read types
// ============================================================

export interface FsReadInput {
  workspace: string;
  path: string;
  maxBytes?: number;
  offset?: number;
}

export interface FsReadOutput {
  content: string;
  truncated: boolean;
  size: number;
  encoding: "utf-8" | "base64";
}

// ============================================================
// fs.apply_patch types
// ============================================================

export interface FsApplyPatchInput {
  workspace: string;
  patchUnified: string;
  dryRun?: boolean;
}

export interface FsApplyPatchOutput {
  filesChanged: string[];
  stats: {
    added: number;
    removed: number;
    modified: number;
  };
  dryRun: boolean;
}

// ============================================================
// git.status types
// ============================================================

export interface GitStatusInput {
  workspace: string;
}

export interface GitStatusFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
}

export interface GitStatusOutput {
  branch: string;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  isClean: boolean;
}

// ============================================================
// git.diff types
// ============================================================

export interface GitDiffInput {
  workspace: string;
  staged?: boolean;
  path?: string;
}

export interface GitDiffOutput {
  diff: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

// ============================================================
// git.checkout types
// ============================================================

export interface GitCheckoutInput {
  workspace: string;
  ref: string;
  createBranch?: boolean;
}

export interface GitCheckoutOutput {
  previousRef: string;
  currentRef: string;
  created: boolean;
}

// ============================================================
// git.commit types
// ============================================================

export interface GitCommitInput {
  workspace: string;
  message: string;
  files?: string[];
  all?: boolean;
}

export interface GitCommitOutput {
  sha: string;
  message: string;
  filesCommitted: number;
}

// ============================================================
// cmd.run types
// ============================================================

export interface CmdRunInput {
  workspace: string;
  command: string;
  args?: string[];
  timeoutS?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface CmdRunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timedOut: boolean;
}

// ============================================================
// Tool registry
// ============================================================

export type ToolName =
  | "fs.list"
  | "fs.read"
  | "fs.apply_patch"
  | "git.status"
  | "git.diff"
  | "git.checkout"
  | "git.commit"
  | "cmd.run";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  tier: "read" | "write" | "exec";
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
}

/**
 * All available tools
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "fs.list",
    description: "List files and directories in a workspace path",
    tier: "read",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        path: { type: "string", description: "Path relative to workspace root" },
        recursive: { type: "boolean", description: "List recursively", default: false },
        maxDepth: { type: "number", description: "Maximum depth for recursive listing" },
      },
      required: ["workspace", "path"],
    },
  },
  {
    name: "fs.read",
    description: "Read contents of a file in the workspace",
    tier: "read",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        path: { type: "string", description: "Path to file relative to workspace root" },
        maxBytes: {
          type: "number",
          description: "Maximum bytes to read",
          default: 200000,
        },
        offset: { type: "number", description: "Byte offset to start reading from" },
      },
      required: ["workspace", "path"],
    },
  },
  {
    name: "fs.apply_patch",
    description: "Apply a unified diff patch to files in the workspace",
    tier: "write",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        patchUnified: { type: "string", description: "Unified diff format patch" },
        dryRun: {
          type: "boolean",
          description: "Preview changes without applying",
          default: false,
        },
      },
      required: ["workspace", "patchUnified"],
    },
  },
  {
    name: "git.status",
    description: "Get git status for the workspace",
    tier: "read",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "git.diff",
    description: "Get git diff for the workspace",
    tier: "read",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        staged: { type: "boolean", description: "Show staged changes only" },
        path: { type: "string", description: "Limit diff to specific path" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "git.checkout",
    description: "Checkout a branch or commit",
    tier: "write",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        ref: { type: "string", description: "Branch name, tag, or commit SHA" },
        createBranch: {
          type: "boolean",
          description: "Create new branch",
          default: false,
        },
      },
      required: ["workspace", "ref"],
    },
  },
  {
    name: "git.commit",
    description: "Create a git commit",
    tier: "write",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        message: { type: "string", description: "Commit message" },
        files: { type: "array", items: { type: "string" }, description: "Files to stage" },
        all: { type: "boolean", description: "Stage all changes", default: false },
      },
      required: ["workspace", "message"],
    },
  },
  {
    name: "cmd.run",
    description: "Run an allowed command in the workspace",
    tier: "exec",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace identifier" },
        command: { type: "string", description: "Command to run" },
        args: { type: "array", items: { type: "string" }, description: "Command arguments" },
        timeoutS: {
          type: "number",
          description: "Timeout in seconds",
          default: 300,
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Environment variables",
        },
        cwd: { type: "string", description: "Working directory relative to workspace" },
      },
      required: ["workspace", "command"],
    },
  },
];
