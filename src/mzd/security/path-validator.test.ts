/**
 * Tests for path validation and workspace scoping
 */

import { describe, it, expect } from "vitest";
import {
  validatePath,
  isPathInWorkspace,
  extractPathsFromPatch,
  validatePatchPaths,
} from "./path-validator.js";
import type { WorkspaceConfig, MzdConfig } from "../config/types.js";
import { getDefaultConfig } from "../config/types.js";

// Test workspace configuration
const createWorkspace = (overrides?: Partial<WorkspaceConfig>): WorkspaceConfig => ({
  name: "test",
  path: "/home/user/myproject",
  tier: "write",
  denyPatterns: [],
  allowGit: true,
  ...overrides,
});

const createConfig = (overrides?: Partial<MzdConfig>): MzdConfig => ({
  ...getDefaultConfig(),
  ...overrides,
});

describe("validatePath", () => {
  it("allows valid paths within workspace", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("src/main.ts", workspace, config);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.absolutePath).toBe("/home/user/myproject/src/main.ts");
      expect(result.relativePath).toBe("src/main.ts");
    }
  });

  it("blocks path traversal attempts", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("../../../etc/passwd", workspace, config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.error.code).toBe("FORBIDDEN_PATH");
    }
  });

  it("blocks absolute paths outside workspace", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("/etc/passwd", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("blocks .ssh directory access", () => {
    const workspace = createWorkspace({ path: "/home/user" });
    const config = createConfig();

    const result = validatePath(".ssh/id_rsa", workspace, config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.error.code).toBe("FORBIDDEN_PATH");
    }
  });

  it("blocks .env files", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath(".env", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("blocks .env.local files", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath(".env.local", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("blocks credentials files", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("config/credentials.json", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("respects workspace-specific deny patterns", () => {
    const workspace = createWorkspace({
      denyPatterns: ["**/*.secret"],
    });
    const config = createConfig();

    const result = validatePath("data/config.secret", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("allows git hooks directory", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    // git hooks should be accessible, just not .git/config
    const result = validatePath(".git/hooks/pre-commit", workspace, config);
    expect(result.valid).toBe(true);
  });

  it("blocks .git/config", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath(".git/config", workspace, config);
    expect(result.valid).toBe(false);
  });

  it("handles normalized paths with ./", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("./src/main.ts", workspace, config);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.relativePath).toBe("src/main.ts");
    }
  });

  it("handles paths with multiple slashes", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const result = validatePath("src//main.ts", workspace, config);
    expect(result.valid).toBe(true);
  });
});

describe("isPathInWorkspace", () => {
  it("returns true for paths inside workspace", () => {
    expect(isPathInWorkspace("src/main.ts", "/home/user/project")).toBe(true);
    expect(isPathInWorkspace("./README.md", "/home/user/project")).toBe(true);
    expect(isPathInWorkspace("/home/user/project/lib", "/home/user/project")).toBe(true);
  });

  it("returns false for paths outside workspace", () => {
    expect(isPathInWorkspace("../other", "/home/user/project")).toBe(false);
    expect(isPathInWorkspace("/etc/passwd", "/home/user/project")).toBe(false);
    expect(isPathInWorkspace("/home/user/other", "/home/user/project")).toBe(false);
  });
});

describe("extractPathsFromPatch", () => {
  it("extracts paths from unified diff", () => {
    const patch = `
diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
+import { foo } from './foo';
 console.log('hello');
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,2 +10,3 @@
 export function bar() {}
+export function baz() {}
`.trim();

    const paths = extractPathsFromPatch(patch);
    expect(paths).toContain("src/main.ts");
    expect(paths).toContain("src/utils.ts");
  });

  it("handles new file creation", () => {
    const patch = `
diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function newFunc() {
+  return true;
+}
`.trim();

    const paths = extractPathsFromPatch(patch);
    expect(paths).toContain("src/new.ts");
    expect(paths).not.toContain("/dev/null");
  });

  it("handles file deletion", () => {
    const patch = `
diff --git a/src/old.ts b/src/old.ts
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldFunc() {
-  return true;
-}
`.trim();

    const paths = extractPathsFromPatch(patch);
    expect(paths).toContain("src/old.ts");
  });

  it("handles renamed files", () => {
    const patch = `
diff --git a/src/old.ts b/src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,3 +1,3 @@
 export function func() {
   return true;
 }
`.trim();

    const paths = extractPathsFromPatch(patch);
    expect(paths).toContain("src/old.ts");
    expect(paths).toContain("src/new.ts");
  });
});

describe("validatePatchPaths", () => {
  it("validates all paths in a patch", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const patch = `
diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
+import { foo } from './foo';
`.trim();

    const result = validatePatchPaths(patch, workspace, config);
    expect(result.valid).toBe(true);
    expect(result.paths).toContain("src/main.ts");
  });

  it("rejects patches with forbidden paths", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const patch = `
diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1,2 @@
 API_KEY=old
+API_KEY=new
`.trim();

    const result = validatePatchPaths(patch, workspace, config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error.code).toBe("FORBIDDEN_PATH");
  });

  it("rejects patches that try to escape workspace", () => {
    const workspace = createWorkspace();
    const config = createConfig();

    const patch = `
diff --git a/../../../etc/passwd b/../../../etc/passwd
--- a/../../../etc/passwd
+++ b/../../../etc/passwd
@@ -1 +1,2 @@
 root:x:0:0:root:/root:/bin/bash
+hacked:x:0:0:hacked:/root:/bin/bash
`.trim();

    const result = validatePatchPaths(patch, workspace, config);
    expect(result.valid).toBe(false);
  });
});
