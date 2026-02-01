/**
 * Filesystem tools implementation
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import type { RunContext } from "../runtime/context.js";
import type { MzdLogger } from "../runtime/logger.js";
import {
  type ToolResult,
  type FsListInput,
  type FsListOutput,
  type FsListEntry,
  type FsReadInput,
  type FsReadOutput,
  type FsApplyPatchInput,
  type FsApplyPatchOutput,
  ToolErrorCode,
  createToolError,
} from "./types.js";
import { validatePath, validatePatchPaths } from "../security/path-validator.js";

/** Maximum entries to return from fs.list */
const MAX_LIST_ENTRIES = 1000;

/** Maximum bytes to read by default */
const DEFAULT_MAX_BYTES = 200000;

/**
 * fs.list - List files and directories
 */
export async function fsList(
  input: FsListInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<FsListOutput>> {
  const { path: inputPath, recursive = false, maxDepth = 10 } = input;

  // Validate path
  const validation = validatePath(inputPath, ctx.workspace, ctx.config);
  if (!validation.valid) {
    return validation.error;
  }

  const { absolutePath, relativePath } = validation;

  try {
    // Check if path exists and is a directory
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return createToolError(
        ToolErrorCode.INVALID_PATH,
        `Path is not a directory: ${relativePath}`,
      );
    }

    const entries: FsListEntry[] = [];

    if (recursive) {
      await listRecursive(absolutePath, ctx.workspace.path, entries, 0, maxDepth, ctx);
    } else {
      const items = await fs.readdir(absolutePath, { withFileTypes: true });

      for (const item of items) {
        if (entries.length >= MAX_LIST_ENTRIES) break;

        const itemPath = path.join(relativePath, item.name);
        const itemAbsPath = path.join(absolutePath, item.name);

        // Validate each path
        const itemValidation = validatePath(itemPath, ctx.workspace, ctx.config);
        if (!itemValidation.valid) continue; // Skip forbidden paths

        try {
          const itemStats = await fs.stat(itemAbsPath);
          entries.push({
            path: itemPath,
            type: item.isDirectory() ? "dir" : item.isSymbolicLink() ? "symlink" : "file",
            size: item.isFile() ? itemStats.size : undefined,
            modified: itemStats.mtime.toISOString(),
          });
        } catch {
          // Skip items we can't stat
        }
      }
    }

    return {
      entries,
      truncated: entries.length >= MAX_LIST_ENTRIES,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createToolError(ToolErrorCode.PATH_NOT_FOUND, `Path not found: ${relativePath}`);
    }
    return createToolError(
      ToolErrorCode.INTERNAL_ERROR,
      `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Recursively list directory contents
 */
async function listRecursive(
  dirPath: string,
  workspacePath: string,
  entries: FsListEntry[],
  depth: number,
  maxDepth: number,
  ctx: RunContext,
): Promise<void> {
  if (depth >= maxDepth || entries.length >= MAX_LIST_ENTRIES) return;

  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      if (entries.length >= MAX_LIST_ENTRIES) break;

      const itemAbsPath = path.join(dirPath, item.name);
      const relativePath = path.relative(workspacePath, itemAbsPath);

      // Validate path
      const validation = validatePath(relativePath, ctx.workspace, ctx.config);
      if (!validation.valid) continue;

      try {
        const stats = await fs.stat(itemAbsPath);
        entries.push({
          path: relativePath,
          type: item.isDirectory() ? "dir" : item.isSymbolicLink() ? "symlink" : "file",
          size: item.isFile() ? stats.size : undefined,
          modified: stats.mtime.toISOString(),
        });

        if (item.isDirectory()) {
          await listRecursive(itemAbsPath, workspacePath, entries, depth + 1, maxDepth, ctx);
        }
      } catch {
        // Skip items we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

/**
 * fs.read - Read file contents
 */
export async function fsRead(
  input: FsReadInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<FsReadOutput>> {
  const { path: inputPath, maxBytes = DEFAULT_MAX_BYTES, offset = 0 } = input;

  // Validate path
  const validation = validatePath(inputPath, ctx.workspace, ctx.config);
  if (!validation.valid) {
    return validation.error;
  }

  const { absolutePath, relativePath } = validation;

  try {
    // Check if file exists
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return createToolError(ToolErrorCode.INVALID_PATH, `Path is not a file: ${relativePath}`);
    }

    // Read file
    const handle = await fs.open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, stats.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);

      // Try to decode as UTF-8
      let content: string;
      let encoding: "utf-8" | "base64";

      try {
        content = buffer.slice(0, bytesRead).toString("utf-8");
        // Check if the content is valid UTF-8 by looking for replacement characters
        if (content.includes("\uFFFD")) {
          throw new Error("Invalid UTF-8");
        }
        encoding = "utf-8";
      } catch {
        // Fall back to base64 for binary files
        content = buffer.slice(0, bytesRead).toString("base64");
        encoding = "base64";
      }

      return {
        content,
        truncated: offset + bytesRead < stats.size,
        size: stats.size,
        encoding,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createToolError(ToolErrorCode.PATH_NOT_FOUND, `File not found: ${relativePath}`);
    }
    return createToolError(
      ToolErrorCode.INTERNAL_ERROR,
      `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * fs.apply_patch - Apply a unified diff patch
 */
export async function fsApplyPatch(
  input: FsApplyPatchInput,
  ctx: RunContext,
  logger: MzdLogger,
): Promise<ToolResult<FsApplyPatchOutput>> {
  const { patchUnified, dryRun = false } = input;

  // Validate all paths in the patch
  const pathValidation = validatePatchPaths(patchUnified, ctx.workspace, ctx.config);
  if (!pathValidation.valid) {
    return pathValidation.errors[0]; // Return first error
  }

  // Check tier (requires write)
  if (ctx.workspace.tier === "read") {
    return createToolError(
      ToolErrorCode.FORBIDDEN_PATH,
      "Workspace has read-only tier. Cannot apply patches.",
    );
  }

  // Check if approval is required
  if (ctx.config.approvals.requireWriteApproval && !dryRun) {
    // In a real implementation, this would trigger an approval flow
    // For now, we'll just note that approval is required
    logger.info("Patch requires approval", { paths: pathValidation.paths });
  }

  try {
    // Apply patch using git apply
    const args = dryRun ? ["apply", "--stat", "--check"] : ["apply", "--stat"];

    const result = execSync(`git ${args.join(" ")}`, {
      cwd: ctx.workspace.path,
      input: patchUnified,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    // Parse stats from output
    const stats = parseGitApplyStats(result);

    return {
      filesChanged: pathValidation.paths,
      stats,
      dryRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check if it's a patch format error
    if (message.includes("patch does not apply") || message.includes("corrupt patch")) {
      return createToolError(
        ToolErrorCode.PATCH_FAILED,
        `Invalid or conflicting patch: ${message}`,
      );
    }

    return createToolError(ToolErrorCode.PATCH_FAILED, `Failed to apply patch: ${message}`);
  }
}

/**
 * Parse git apply --stat output
 */
function parseGitApplyStats(output: string): { added: number; removed: number; modified: number } {
  const stats = { added: 0, removed: 0, modified: 0 };

  // Parse lines like: " src/file.ts | 10 ++++----"
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/(\d+)\s*(\++)?(-+)?/);
    if (match) {
      const plusCount = (match[2] || "").length;
      const minusCount = (match[3] || "").length;
      stats.added += plusCount;
      stats.removed += minusCount;
      if (plusCount > 0 || minusCount > 0) {
        stats.modified++;
      }
    }
  }

  return stats;
}
