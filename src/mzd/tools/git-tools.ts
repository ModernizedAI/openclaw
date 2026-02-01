/**
 * Git tools implementation
 */

import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import {
  type ToolResult,
  type GitStatusInput,
  type GitStatusOutput,
  type GitStatusFile,
  type GitDiffInput,
  type GitDiffOutput,
  type GitCheckoutInput,
  type GitCheckoutOutput,
  type GitCommitInput,
  type GitCommitOutput,
  ToolErrorCode,
  createToolError,
} from "./types.js";

const execAsync = promisify(exec);

/** Maximum diff output size */
const MAX_DIFF_SIZE = 500000;

/**
 * Execute a git command
 */
async function execGit(
  args: string[],
  cwd: string,
  options?: { maxBuffer?: number },
): Promise<string> {
  const { stdout } = await execAsync(`git ${args.join(" ")}`, {
    cwd,
    maxBuffer: options?.maxBuffer || 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * git.status - Get repository status
 */
export async function gitStatus(
  input: GitStatusInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<GitStatusOutput>> {
  if (!ctx.workspace.allowGit) {
    return createToolError(ToolErrorCode.GIT_ERROR, "Git operations disabled for this workspace");
  }

  try {
    // Get branch info
    const branchOutput = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], ctx.workspace.path);
    const branch = branchOutput.trim();

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const countOutput = await execGit(
        ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"],
        ctx.workspace.path,
      );
      const [behindStr, aheadStr] = countOutput.trim().split("\t");
      behind = parseInt(behindStr, 10) || 0;
      ahead = parseInt(aheadStr, 10) || 0;
    } catch {
      // No upstream configured
    }

    // Get file status using porcelain format
    const statusOutput = await execGit(["status", "--porcelain=v1"], ctx.workspace.path);
    const files: GitStatusFile[] = [];

    for (const line of statusOutput.split("\n")) {
      if (!line) continue;

      const indexStatus = line[0];
      const workStatus = line[1];
      const filePath = line.slice(3).trim();

      // Determine status
      let status: GitStatusFile["status"];
      let staged = false;

      if (indexStatus === "?" && workStatus === "?") {
        status = "untracked";
      } else if (indexStatus === "U" || workStatus === "U") {
        status = "conflicted";
      } else if (indexStatus === "A") {
        status = "added";
        staged = true;
      } else if (indexStatus === "D" || workStatus === "D") {
        status = "deleted";
        staged = indexStatus === "D";
      } else if (indexStatus === "R") {
        status = "renamed";
        staged = true;
      } else if (indexStatus === "M" || workStatus === "M") {
        status = "modified";
        staged = indexStatus === "M";
      } else {
        status = "modified";
      }

      files.push({ path: filePath, status, staged });
    }

    return {
      branch,
      ahead,
      behind,
      files,
      isClean: files.length === 0,
    };
  } catch (error) {
    return createToolError(
      ToolErrorCode.GIT_ERROR,
      `Failed to get git status: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * git.diff - Get repository diff
 */
export async function gitDiff(
  input: GitDiffInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<GitDiffOutput>> {
  if (!ctx.workspace.allowGit) {
    return createToolError(ToolErrorCode.GIT_ERROR, "Git operations disabled for this workspace");
  }

  try {
    const args = ["diff"];
    if (input.staged) {
      args.push("--staged");
    }
    if (input.path) {
      args.push("--", input.path);
    }

    const diff = await execGit(args, ctx.workspace.path, { maxBuffer: MAX_DIFF_SIZE });

    // Get stats
    const statsArgs = [...args, "--stat"];
    const statsOutput = await execGit(statsArgs, ctx.workspace.path);

    // Parse stats from last line: " 3 files changed, 10 insertions(+), 5 deletions(-)"
    const statsMatch = statsOutput.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );

    const stats = {
      filesChanged: statsMatch ? parseInt(statsMatch[1], 10) : 0,
      insertions: statsMatch && statsMatch[2] ? parseInt(statsMatch[2], 10) : 0,
      deletions: statsMatch && statsMatch[3] ? parseInt(statsMatch[3], 10) : 0,
    };

    return { diff, stats };
  } catch (error) {
    return createToolError(
      ToolErrorCode.GIT_ERROR,
      `Failed to get git diff: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * git.checkout - Checkout a branch or commit
 */
export async function gitCheckout(
  input: GitCheckoutInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<GitCheckoutOutput>> {
  if (!ctx.workspace.allowGit) {
    return createToolError(ToolErrorCode.GIT_ERROR, "Git operations disabled for this workspace");
  }

  // Check tier (requires write)
  if (ctx.workspace.tier === "read") {
    return createToolError(
      ToolErrorCode.FORBIDDEN_PATH,
      "Workspace has read-only tier. Cannot checkout branches.",
    );
  }

  try {
    // Get current ref
    const previousRef = (
      await execGit(["rev-parse", "--abbrev-ref", "HEAD"], ctx.workspace.path)
    ).trim();

    // Checkout
    const args = ["checkout"];
    if (input.createBranch) {
      args.push("-b");
    }
    args.push(input.ref);

    await execGit(args, ctx.workspace.path);

    // Get new ref
    const currentRef = (
      await execGit(["rev-parse", "--abbrev-ref", "HEAD"], ctx.workspace.path)
    ).trim();

    return {
      previousRef,
      currentRef,
      created: input.createBranch ?? false,
    };
  } catch (error) {
    return createToolError(
      ToolErrorCode.GIT_ERROR,
      `Failed to checkout: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * git.commit - Create a commit
 */
export async function gitCommit(
  input: GitCommitInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<GitCommitOutput>> {
  if (!ctx.workspace.allowGit) {
    return createToolError(ToolErrorCode.GIT_ERROR, "Git operations disabled for this workspace");
  }

  // Check tier (requires write)
  if (ctx.workspace.tier === "read") {
    return createToolError(
      ToolErrorCode.FORBIDDEN_PATH,
      "Workspace has read-only tier. Cannot create commits.",
    );
  }

  try {
    // Stage files
    if (input.files && input.files.length > 0) {
      for (const file of input.files) {
        await execGit(["add", file], ctx.workspace.path);
      }
    } else if (input.all) {
      await execGit(["add", "-A"], ctx.workspace.path);
    }

    // Create commit
    const commitOutput = await execGit(["commit", "-m", input.message], ctx.workspace.path);

    // Get commit SHA
    const sha = (await execGit(["rev-parse", "HEAD"], ctx.workspace.path)).trim();

    // Parse files committed from output
    const filesMatch = commitOutput.match(/(\d+) files? changed/);
    const filesCommitted = filesMatch ? parseInt(filesMatch[1], 10) : 0;

    return {
      sha,
      message: input.message,
      filesCommitted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for nothing to commit
    if (message.includes("nothing to commit")) {
      return createToolError(ToolErrorCode.GIT_ERROR, "Nothing to commit");
    }

    return createToolError(ToolErrorCode.GIT_ERROR, `Failed to commit: ${message}`);
  }
}
