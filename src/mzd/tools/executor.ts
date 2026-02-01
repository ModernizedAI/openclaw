/**
 * Tool executor - Routes tool calls to implementations
 */

import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import {
  type ToolName,
  type ToolResult,
  type FsListInput,
  type FsListOutput,
  type FsReadInput,
  type FsReadOutput,
  type FsApplyPatchInput,
  type FsApplyPatchOutput,
  type GitStatusInput,
  type GitStatusOutput,
  type GitDiffInput,
  type GitDiffOutput,
  type GitCheckoutInput,
  type GitCheckoutOutput,
  type GitCommitInput,
  type GitCommitOutput,
  type CmdRunInput,
  type CmdRunOutput,
  ToolErrorCode,
  createToolError,
  TOOL_DEFINITIONS,
} from "./types.js";
import { fsList, fsRead, fsApplyPatch } from "./fs-tools.js";
import { gitStatus, gitDiff, gitCheckout, gitCommit } from "./git-tools.js";
import { cmdRun } from "./cmd-tools.js";

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<unknown>> {
  // Find tool definition
  const toolDef = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!toolDef) {
    return createToolError(ToolErrorCode.INTERNAL_ERROR, `Unknown tool: ${name}`);
  }

  // Check tier permissions
  const tierPriority: Record<string, number> = {
    read: 1,
    write: 2,
    exec: 3,
  };

  if (tierPriority[toolDef.tier] > tierPriority[ctx.workspace.tier]) {
    return createToolError(
      ToolErrorCode.FORBIDDEN_PATH,
      `Tool "${name}" requires "${toolDef.tier}" tier, but workspace has "${ctx.workspace.tier}"`,
    );
  }

  // Route to appropriate handler
  switch (name) {
    case "fs.list":
      return fsList(input as unknown as FsListInput, ctx, logger);

    case "fs.read":
      return fsRead(input as unknown as FsReadInput, ctx, logger);

    case "fs.apply_patch":
      return fsApplyPatch(input as unknown as FsApplyPatchInput, ctx, logger);

    case "git.status":
      return gitStatus(input as unknown as GitStatusInput, ctx, logger);

    case "git.diff":
      return gitDiff(input as unknown as GitDiffInput, ctx, logger);

    case "git.checkout":
      return gitCheckout(input as unknown as GitCheckoutInput, ctx, logger);

    case "git.commit":
      return gitCommit(input as unknown as GitCommitInput, ctx, logger);

    case "cmd.run":
      return cmdRun(input as unknown as CmdRunInput, ctx, logger);

    default:
      return createToolError(ToolErrorCode.INTERNAL_ERROR, `Unimplemented tool: ${name}`);
  }
}
