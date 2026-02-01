/**
 * Command validation and allowlist enforcement
 */

import type { CommandAllowlist } from "../config/types.js";
import { ToolErrorCode, createToolError, type ToolError } from "../tools/types.js";

/**
 * Default allowed commands (safe read-only or build commands)
 */
export const DEFAULT_ALLOWED_COMMANDS: RegExp[] = [
  // Version/help commands
  /^(node|npm|npx|pnpm|bunx?|yarn|deno|python3?|ruby|go|cargo|make|cmake)\s+(--version|-v|--help|-h)$/,

  // Package managers - read/install only
  /^npm\s+(list|ls|outdated|audit|view|info|search|run|test|exec)(\s|$)/,
  /^pnpm\s+(list|ls|outdated|audit|view|run|test|exec)(\s|$)/,
  /^yarn\s+(list|outdated|info|run|test)(\s|$)/,
  /^bun\s+(run|test|x)(\s|$)/,

  // Build tools
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(build|compile|bundle|prepare)(\s|$)/,
  /^(make|cmake)(\s+-j\d+)?(\s+\w+)?$/,
  /^cargo\s+(build|check|clippy|fmt|test)(\s|$)/,
  /^go\s+(build|test|vet|fmt|mod)(\s|$)/,

  // Test runners
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test(\s|$)/,
  /^(pytest|jest|vitest|mocha|ava|tap|bun test)(\s|$)/,
  /^python3?\s+-m\s+(pytest|unittest)(\s|$)/,

  // Linters and formatters
  /^(eslint|prettier|oxlint|biome|ruff|black|isort|gofmt|rustfmt)(\s|$)/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|format|check)(\s|$)/,

  // Type checkers
  /^(tsc|pyright|mypy)(\s|$)/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(typecheck|types)(\s|$)/,

  // Git read-only commands
  /^git\s+(status|log|diff|show|branch|tag|remote|config\s+--get)(\s|$)/,
  /^git\s+ls-files(\s|$)/,

  // File listing (read-only)
  /^ls(\s|$)/,
  /^find\s+\.\s/,
  /^tree(\s|$)/,
  /^wc(\s|$)/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^cat(\s|$)/,
  /^less(\s|$)/,
  /^grep(\s|$)/,
  /^rg(\s|$)/,
  /^ag(\s|$)/,
  /^fd(\s|$)/,
];

/**
 * Commands that are always denied (dangerous operations)
 */
export const ALWAYS_DENIED_PATTERNS: RegExp[] = [
  // Destructive operations
  /^rm\s+-rf\s+\//, // rm -rf /
  /^rm\s+-rf\s+~/, // rm -rf ~
  /^rm\s+--no-preserve-root/, // rm with dangerous flag
  /^mkfs/, // Format filesystems
  /^dd\s+.*of=\/dev/, // Writing to devices

  // Network exfiltration
  /^curl\s+.*-d\s+@/, // curl with file upload
  /^wget\s+.*--post-file/, // wget with file upload
  /^scp\s+.*@.*:/, // scp to remote
  /^rsync\s+.*@.*:/, // rsync to remote

  // Privilege escalation
  /^sudo\s/, // sudo
  /^su\s/, // su
  /^doas\s/, // doas

  // Cron/scheduled tasks
  /^crontab/, // crontab modifications
  /^at\s/, // at scheduling

  // Service management
  /^systemctl\s+(start|stop|restart|enable|disable)/, // systemd control
  /^service\s+\w+\s+(start|stop|restart)/, // service control
  /^launchctl\s+(load|unload|kickstart)/, // launchd control

  // Package installation (system-wide)
  /^apt(-get)?\s+(install|remove|purge)/, // apt
  /^yum\s+(install|remove)/, // yum
  /^dnf\s+(install|remove)/, // dnf
  /^brew\s+(install|uninstall|remove)/, // homebrew

  // Shell escapes
  /;\s*sh(\s|$)/, // ; sh
  /\|\s*sh(\s|$)/, // | sh
  /`.*`/, // backtick execution
  /\$\(.*\)/, // command substitution

  // Environment manipulation
  /^export\s+.*=/, // export with assignment
  /^env\s+\w+=/, // env with assignment

  // Python/Node dangerous patterns
  /python.*-c\s+['"].*import\s+(os|subprocess|socket)/, // python exec dangerous modules
  /node.*-e\s+['"].*require\s*\(['"]child_process/, // node exec child_process
];

/**
 * Result of command validation
 */
export type CommandValidationResult = { allowed: true } | { allowed: false; error: ToolError };

/**
 * Validate a command against allowlist and denylist
 */
export function validateCommand(
  command: string,
  args: string[] = [],
  allowlist: CommandAllowlist,
): CommandValidationResult {
  // Build full command string for pattern matching
  const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;

  // First check always-denied patterns
  for (const pattern of ALWAYS_DENIED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      return {
        allowed: false,
        error: createToolError(
          ToolErrorCode.COMMAND_DENIED,
          `Command matches dangerous pattern and is not allowed`,
          { command: fullCommand, pattern: pattern.source },
        ),
      };
    }
  }

  // Check config deny patterns
  for (const pattern of allowlist.deny) {
    try {
      if (new RegExp(pattern).test(fullCommand)) {
        return {
          allowed: false,
          error: createToolError(
            ToolErrorCode.COMMAND_DENIED,
            `Command matches deny pattern in configuration`,
            { command: fullCommand, pattern },
          ),
        };
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Check config allow patterns first (takes precedence)
  for (const pattern of allowlist.allow) {
    try {
      if (new RegExp(pattern).test(fullCommand)) {
        return { allowed: true };
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Check default allowed patterns
  for (const pattern of DEFAULT_ALLOWED_COMMANDS) {
    if (pattern.test(fullCommand)) {
      return { allowed: true };
    }
  }

  // Not explicitly allowed
  return {
    allowed: false,
    error: createToolError(
      ToolErrorCode.COMMAND_DENIED,
      `Command not in allowlist. Add it to config.commands.allow if needed.`,
      { command: fullCommand },
    ),
  };
}

/**
 * Parse a command string into command and args
 */
export function parseCommand(commandString: string): { command: string; args: string[] } {
  // Simple parsing - splits on whitespace, respects quotes
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let escaped = false;

  for (const char of commandString) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if (char === " " || char === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return {
    command: parts[0] || "",
    args: parts.slice(1),
  };
}

/**
 * Get a safe display version of a command (truncated if long)
 */
export function formatCommandForDisplay(
  command: string,
  args: string[] = [],
  maxLength = 80,
): string {
  const full = args.length > 0 ? `${command} ${args.join(" ")}` : command;
  if (full.length <= maxLength) {
    return full;
  }
  return `${full.slice(0, maxLength - 3)}...`;
}
