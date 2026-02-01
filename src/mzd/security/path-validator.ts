/**
 * Path validation and workspace scoping
 */

import path from "node:path";
import type { WorkspaceConfig, MzdConfig } from "../config/types.js";
import { ToolErrorCode, createToolError, type ToolError } from "../tools/types.js";

/**
 * Simple glob pattern matching (supports *, **, and ?)
 * This is a lightweight alternative to minimatch
 */
function matchGlob(pattern: string, str: string): boolean {
  // Handle **/ at the start (matches zero or more directories)
  let processedPattern = pattern;

  // **/ at start should match the path from root or any subdirectory
  if (processedPattern.startsWith("**/")) {
    // Pattern matches from any directory level
    processedPattern = processedPattern.slice(3);

    // Try matching from the beginning and from each directory level
    const parts = str.split("/");
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(i).join("/");
      if (matchGlobSimple(processedPattern, subPath)) {
        return true;
      }
    }
    return false;
  }

  return matchGlobSimple(processedPattern, str);
}

/**
 * Simple glob matching without double-star-slash prefix handling
 */
function matchGlobSimple(pattern: string, str: string): boolean {
  // Escape special regex characters except *, ?, and **
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*\*/g, "\0DOUBLESTAR\0") // Placeholder for **
    .replace(/\*/g, "[^/]*") // Single * matches anything except /
    .replace(/\?/g, "[^/]") // ? matches single char except /
    .replace(/\0DOUBLESTAR\0/g, ".*"); // ** matches anything including /

  // Add anchors
  regex = `^${regex}$`;

  try {
    return new RegExp(regex).test(str);
  } catch {
    return false;
  }
}

/**
 * Result of path validation
 */
export type PathValidationResult =
  | { valid: true; absolutePath: string; relativePath: string }
  | { valid: false; error: ToolError };

/**
 * Default deny patterns for sensitive paths
 */
export const DEFAULT_DENY_PATTERNS = [
  // Git internals (but allow .git/hooks for pre-commit)
  "**/.git/config",
  "**/.git/credentials",
  "**/.git/objects/**",
  "**/.git/refs/**",
  // SSH keys
  "**/.ssh/**",
  // AWS credentials
  "**/.aws/**",
  // Environment files
  "**/.env",
  "**/.env.*",
  "**/.env.local",
  "**/.env.*.local",
  // Secret directories
  "**/secrets/**",
  "**/.secrets/**",
  // Private keys
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  // Credential files
  "**/credentials*",
  "**/password*",
  "**/token*",
  // Package managers sensitive
  "**/.npmrc",
  "**/.pypirc",
  // macOS/Windows system
  "**/.DS_Store",
  "**/Thumbs.db",
];

/**
 * Validate and resolve a path within a workspace
 */
export function validatePath(
  inputPath: string,
  workspace: WorkspaceConfig,
  config: MzdConfig,
): PathValidationResult {
  // Normalize the input path
  const normalizedInput = path.normalize(inputPath);

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.join(workspace.path, normalizedInput);

  // Get the relative path from workspace root
  const relativePath = path.relative(workspace.path, absolutePath);

  // Check for path traversal (escaping workspace)
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return {
      valid: false,
      error: createToolError(
        ToolErrorCode.FORBIDDEN_PATH,
        `Path escapes workspace boundary: ${inputPath}`,
        { workspace: workspace.name, attemptedPath: absolutePath },
      ),
    };
  }

  // Combine deny patterns
  const denyPatterns = [
    ...DEFAULT_DENY_PATTERNS,
    ...config.globalDenyPatterns,
    ...workspace.denyPatterns,
  ];

  // Check against deny patterns
  for (const pattern of denyPatterns) {
    if (matchGlob(pattern, relativePath)) {
      return {
        valid: false,
        error: createToolError(
          ToolErrorCode.FORBIDDEN_PATH,
          `Path matches deny pattern: ${pattern}`,
          { workspace: workspace.name, path: relativePath, pattern },
        ),
      };
    }

    // Also check the absolute path for patterns starting with /
    if (pattern.startsWith("/") && matchGlob(pattern, absolutePath)) {
      return {
        valid: false,
        error: createToolError(
          ToolErrorCode.FORBIDDEN_PATH,
          `Absolute path matches deny pattern: ${pattern}`,
          { workspace: workspace.name, path: absolutePath, pattern },
        ),
      };
    }
  }

  return {
    valid: true,
    absolutePath,
    relativePath,
  };
}

/**
 * Validate multiple paths
 */
export function validatePaths(
  paths: string[],
  workspace: WorkspaceConfig,
  config: MzdConfig,
): PathValidationResult[] {
  return paths.map((p) => validatePath(p, workspace, config));
}

/**
 * Check if a path is within workspace bounds (without deny pattern check)
 */
export function isPathInWorkspace(inputPath: string, workspacePath: string): boolean {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(workspacePath, inputPath);

  const relativePath = path.relative(workspacePath, absolutePath);

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * Sanitize a path for display (hide full system paths)
 */
export function sanitizePathForDisplay(absolutePath: string, workspacePath: string): string {
  if (absolutePath.startsWith(workspacePath)) {
    return path.relative(workspacePath, absolutePath) || ".";
  }
  return absolutePath;
}

/**
 * Parse paths from a unified diff
 */
export function extractPathsFromPatch(patch: string): string[] {
  const paths = new Set<string>();
  const lines = patch.split("\n");

  for (const line of lines) {
    // Match diff headers: diff --git a/path b/path
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      paths.add(diffMatch[1]);
      paths.add(diffMatch[2]);
      continue;
    }

    // Match --- and +++ lines
    const minusMatch = line.match(/^--- a\/(.+)$/);
    if (minusMatch && minusMatch[1] !== "/dev/null") {
      paths.add(minusMatch[1]);
      continue;
    }

    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch && plusMatch[1] !== "/dev/null") {
      paths.add(plusMatch[1]);
    }
  }

  return Array.from(paths);
}

/**
 * Validate all paths in a patch
 */
export function validatePatchPaths(
  patch: string,
  workspace: WorkspaceConfig,
  config: MzdConfig,
): { valid: boolean; paths: string[]; errors: ToolError[] } {
  const paths = extractPathsFromPatch(patch);
  const errors: ToolError[] = [];

  for (const p of paths) {
    const result = validatePath(p, workspace, config);
    if (!result.valid) {
      errors.push(result.error);
    }
  }

  return {
    valid: errors.length === 0,
    paths,
    errors,
  };
}
