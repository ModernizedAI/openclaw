/**
 * Logging infrastructure for mzd
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { LoggingConfig } from "../config/types.js";
import type { RunId, AuditLogEntry } from "./context.js";
import { getConfigDir } from "../config/loader.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger instance for a run
 */
export interface MzdLogger {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  tool: (name: string, input: unknown, output: unknown, duration_ms: number) => void;
  approval: (id: string, type: string, approved: boolean, details?: unknown) => void;
  flush: () => Promise<void>;
}

/**
 * Format a log message for console output
 */
function formatConsoleMessage(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  config?: LoggingConfig,
): string {
  const parts: string[] = [];

  if (config?.timestamps ?? true) {
    parts.push(`[${new Date().toISOString()}]`);
  }

  parts.push(`[${level.toUpperCase().padEnd(5)}]`);
  parts.push(message);

  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data));
  }

  return parts.join(" ");
}

/**
 * Format a log entry as JSON
 */
function formatJsonLog(
  level: LogLevel,
  message: string,
  runId: RunId,
  data?: Record<string, unknown>,
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    runId,
    message,
    ...data,
  });
}

/**
 * Create a logger for a run
 */
export function createLogger(
  runId: RunId,
  config: LoggingConfig,
  options?: {
    quiet?: boolean;
    verbose?: boolean;
  },
): MzdLogger {
  const logBuffer: string[] = [];
  const effectiveLevel: LogLevel = options?.verbose ? "debug" : config.level;
  const shouldLog = (level: LogLevel): boolean =>
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[effectiveLevel];

  const log = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (!shouldLog(level)) return;

    const formattedLine = config.jsonLogs
      ? formatJsonLog(level, message, runId, data)
      : formatConsoleMessage(level, message, data, config);

    // Buffer for file writing
    logBuffer.push(formattedLine);

    // Console output unless quiet
    if (!options?.quiet) {
      const output = level === "error" ? console.error : console.log;
      output(formattedLine);
    }
  };

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),

    tool: (name, input, output, duration_ms) => {
      log("info", `Tool: ${name}`, {
        input: typeof input === "object" ? input : { value: input },
        output: typeof output === "object" ? output : { value: output },
        duration_ms,
      });
    },

    approval: (id, type, approved, details) => {
      log("info", `Approval: ${type} ${approved ? "APPROVED" : "DENIED"}`, {
        approvalId: id,
        type,
        approved,
        ...(details ? { details } : {}),
      });
    },

    flush: async () => {
      if (!config.logDir || logBuffer.length === 0) return;

      const logDir = config.logDir.startsWith("~")
        ? path.join(getConfigDir(), "logs")
        : config.logDir;

      await fs.mkdir(logDir, { recursive: true });

      const logFile = path.join(logDir, `${runId}.log`);
      await fs.appendFile(logFile, logBuffer.join("\n") + "\n");
      logBuffer.length = 0;
    },
  };
}

/**
 * Write audit log to file
 */
export async function writeAuditLog(
  runId: RunId,
  entries: AuditLogEntry[],
  logDir?: string,
): Promise<string> {
  const dir = logDir || path.join(getConfigDir(), "audit");
  await fs.mkdir(dir, { recursive: true });

  const logFile = path.join(dir, `${runId}.jsonl`);
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

  await fs.writeFile(logFile, content);
  return logFile;
}

/**
 * Read audit log from file
 */
export async function readAuditLog(runId: RunId, logDir?: string): Promise<AuditLogEntry[]> {
  const dir = logDir || path.join(getConfigDir(), "audit");
  const logFile = path.join(dir, `${runId}.jsonl`);

  try {
    const content = await fs.readFile(logFile, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line)
      .map((line) => JSON.parse(line) as AuditLogEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * List available run logs
 */
export async function listRunLogs(logDir?: string): Promise<
  Array<{
    runId: RunId;
    timestamp: Date;
    size: number;
  }>
> {
  const dir = logDir || path.join(getConfigDir(), "audit");

  try {
    const files = await fs.readdir(dir);
    const logs: Array<{ runId: RunId; timestamp: Date; size: number }> = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const runId = file.replace(".jsonl", "");
      const stats = await fs.stat(path.join(dir, file));

      logs.push({
        runId,
        timestamp: stats.mtime,
        size: stats.size,
      });
    }

    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
