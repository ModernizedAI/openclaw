/**
 * Command execution tools
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import {
  type ToolResult,
  type CmdRunInput,
  type CmdRunOutput,
  ToolErrorCode,
  createToolError,
} from "./types.js";
import { validateCommand, parseCommand } from "../security/command-validator.js";
import { validatePath } from "../security/path-validator.js";

/** Default timeout in seconds */
const DEFAULT_TIMEOUT_S = 300;

/** Maximum output size in bytes */
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

/**
 * cmd.run - Run an allowed command
 */
export async function cmdRun(
  input: CmdRunInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<CmdRunOutput>> {
  // Check tier (requires exec)
  if (ctx.workspace.tier !== "exec") {
    return createToolError(
      ToolErrorCode.COMMAND_DENIED,
      `Workspace has "${ctx.workspace.tier}" tier. Command execution requires "exec" tier.`,
    );
  }

  const { command, args = [], timeoutS = DEFAULT_TIMEOUT_S, env = {}, cwd } = input;

  // Parse and validate command
  const parsed = parseCommand(command);
  const fullArgs = [...parsed.args, ...args];
  const validation = validateCommand(parsed.command, fullArgs, ctx.config.commands);

  if (!validation.allowed) {
    return validation.error;
  }

  // Validate cwd if provided
  let workingDir = ctx.workspace.path;
  if (cwd) {
    const cwdValidation = validatePath(cwd, ctx.workspace, ctx.config);
    if (!cwdValidation.valid) {
      return cwdValidation.error;
    }
    workingDir = cwdValidation.absolutePath;
  }

  // Check if approval is required
  if (ctx.config.approvals.requireExecApproval) {
    logger.info("Command requires approval", {
      command: parsed.command,
      args: fullArgs,
    });
    // In a real implementation, this would trigger an approval flow
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Spawn process
    const proc = spawn(parsed.command, fullArgs, {
      cwd: workingDir,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Set timeout
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutS * 1000);

    // Collect stdout
    proc.stdout?.on("data", (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.slice(0, MAX_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED]";
        }
      }
    });

    // Collect stderr
    proc.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(0, MAX_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED]";
        }
      }
    });

    // Handle completion
    proc.on("close", (code) => {
      clearTimeout(timeout);
      const duration_ms = Date.now() - startTime;

      if (timedOut) {
        resolve({
          exitCode: code ?? 124,
          stdout,
          stderr: stderr + `\n[TIMEOUT after ${timeoutS}s]`,
          duration_ms,
          timedOut: true,
        });
      } else {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          duration_ms,
          timedOut: false,
        });
      }
    });

    // Handle errors
    proc.on("error", (error) => {
      clearTimeout(timeout);
      const duration_ms = Date.now() - startTime;

      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
        duration_ms,
        timedOut: false,
      });
    });
  });
}
