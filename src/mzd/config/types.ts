/**
 * Configuration types for the mzd agent runner
 */

import { z } from "zod";

/**
 * Permission tiers for tool access
 */
export type PermissionTier = "read" | "write" | "exec";

/**
 * Workspace configuration
 */
export const WorkspaceConfigSchema = z.object({
  /** Workspace identifier */
  name: z.string(),
  /** Absolute path to workspace root */
  path: z.string(),
  /** Permission tier for this workspace */
  tier: z.enum(["read", "write", "exec"]).default("read"),
  /** Patterns to deny access to (glob patterns) */
  denyPatterns: z.array(z.string()).default([]),
  /** Whether to allow git operations */
  allowGit: z.boolean().default(true),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/**
 * Command allowlist configuration
 */
export const CommandAllowlistSchema = z.object({
  /** Command patterns that are allowed (regex) */
  allow: z.array(z.string()).default([]),
  /** Command patterns that are explicitly denied (regex) */
  deny: z.array(z.string()).default([]),
});

export type CommandAllowlist = z.infer<typeof CommandAllowlistSchema>;

/**
 * Server configuration
 */
export const ServerConfigSchema = z.object({
  /** Host to bind to */
  host: z.string().default("127.0.0.1"),
  /** Port to listen on */
  port: z.number().default(3847),
  /** Transport mode */
  transport: z.enum(["stdio", "http", "tailscale"]).default("stdio"),
  /** Enable request logging */
  enableRequestLogging: z.boolean().default(true),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * Approval configuration
 */
export const ApprovalConfigSchema = z.object({
  /** Require approval for write operations */
  requireWriteApproval: z.boolean().default(true),
  /** Require approval for command execution */
  requireExecApproval: z.boolean().default(true),
  /** Auto-approve patterns (glob) */
  autoApprovePatterns: z.array(z.string()).default([]),
  /** Timeout for approval prompts (ms) */
  approvalTimeoutMs: z.number().default(300000), // 5 minutes
});

export type ApprovalConfig = z.infer<typeof ApprovalConfigSchema>;

/**
 * Logging configuration
 */
export const LoggingConfigSchema = z.object({
  /** Log level */
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Directory for log files */
  logDir: z.string().optional(),
  /** Enable structured JSON logging */
  jsonLogs: z.boolean().default(false),
  /** Include timestamps */
  timestamps: z.boolean().default(true),
});

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

/**
 * Main mzd configuration
 */
export const MzdConfigSchema = z.object({
  /** Config version */
  version: z.literal(1).default(1),
  /** Workspace configurations */
  workspaces: z.array(WorkspaceConfigSchema).default([]),
  /** Default workspace name */
  defaultWorkspace: z.string().optional(),
  /** Server configuration */
  server: ServerConfigSchema.optional().default({
    host: "127.0.0.1",
    port: 3847,
    transport: "stdio" as const,
    enableRequestLogging: true,
  }),
  /** Command allowlist */
  commands: CommandAllowlistSchema.optional().default({
    allow: [],
    deny: [],
  }),
  /** Approval settings */
  approvals: ApprovalConfigSchema.optional().default({
    requireWriteApproval: true,
    requireExecApproval: true,
    autoApprovePatterns: [],
    approvalTimeoutMs: 300000,
  }),
  /** Logging settings */
  logging: LoggingConfigSchema.optional().default({
    level: "info" as const,
    jsonLogs: false,
    timestamps: true,
  }),
  /** Default deny patterns applied to all workspaces */
  globalDenyPatterns: z
    .array(z.string())
    .default([
      "**/.git/config",
      "**/.ssh/**",
      "**/.aws/**",
      "**/.env",
      "**/.env.*",
      "**/secrets/**",
      "**/*.pem",
      "**/*.key",
      "**/credentials*",
      "**/node_modules/**",
    ]),
});

export type MzdConfig = z.infer<typeof MzdConfigSchema>;

/**
 * Default configuration
 */
export function getDefaultConfig(): MzdConfig {
  return MzdConfigSchema.parse({});
}
