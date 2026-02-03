# Tools

The mzd daemon provides a set of tools for filesystem, git, and command operations. All tools are scoped to configured workspaces and respect permission tiers.

## Filesystem Tools

### fs.list

List directory contents.

**Tier:** `read`

**Input:**
```json
{
  "path": "/path/to/directory",
  "showHidden": false,
  "recursive": false,
  "maxDepth": 3
}
```

**Output:**
```json
{
  "path": "/path/to/directory",
  "entries": [
    {
      "name": "file.ts",
      "type": "file",
      "size": 1234,
      "modified": "2024-01-15T10:30:00Z"
    },
    {
      "name": "src",
      "type": "directory"
    }
  ]
}
```

### fs.read

Read file contents.

**Tier:** `read`

**Input:**
```json
{
  "path": "/path/to/file.ts",
  "encoding": "utf-8",
  "startLine": 1,
  "endLine": 100
}
```

**Output:**
```json
{
  "path": "/path/to/file.ts",
  "content": "file contents here...",
  "size": 1234,
  "lines": 50,
  "truncated": false
}
```

### fs.write

Write file contents.

**Tier:** `write`

**Input:**
```json
{
  "path": "/path/to/file.ts",
  "content": "new file contents",
  "createDirs": true
}
```

**Output:**
```json
{
  "path": "/path/to/file.ts",
  "bytesWritten": 17,
  "created": true
}
```

### fs.apply_patch

Apply a unified diff patch.

**Tier:** `write`

**Input:**
```json
{
  "path": "/path/to/file.ts",
  "patch": "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3"
}
```

**Output:**
```json
{
  "path": "/path/to/file.ts",
  "applied": true,
  "hunks": 1
}
```

## Git Tools

### git.status

Get git repository status.

**Tier:** `read`

**Input:**
```json
{
  "path": "/path/to/repo"
}
```

**Output:**
```json
{
  "branch": "main",
  "ahead": 0,
  "behind": 0,
  "staged": ["file1.ts"],
  "modified": ["file2.ts"],
  "untracked": ["new-file.ts"]
}
```

### git.log

Get commit history.

**Tier:** `read`

**Input:**
```json
{
  "path": "/path/to/repo",
  "maxCount": 10,
  "since": "2024-01-01"
}
```

**Output:**
```json
{
  "commits": [
    {
      "sha": "abc123",
      "message": "Add feature",
      "author": "User Name",
      "date": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### git.diff

Get diff of changes.

**Tier:** `read`

**Input:**
```json
{
  "path": "/path/to/repo",
  "staged": false,
  "commit": "HEAD~1"
}
```

**Output:**
```json
{
  "diff": "diff --git a/file.ts b/file.ts\n..."
}
```

### git.add

Stage files.

**Tier:** `write`

**Input:**
```json
{
  "path": "/path/to/repo",
  "files": ["file1.ts", "file2.ts"]
}
```

### git.commit

Create a commit.

**Tier:** `write`

**Input:**
```json
{
  "path": "/path/to/repo",
  "message": "Add feature X"
}
```

**Output:**
```json
{
  "sha": "abc123def456",
  "message": "Add feature X"
}
```

### git.branch

Create or switch branches.

**Tier:** `write`

**Input:**
```json
{
  "path": "/path/to/repo",
  "name": "feature/new-feature",
  "create": true
}
```

## Command Tools

### cmd.run

Execute a shell command.

**Tier:** `exec`

**Input:**
```json
{
  "command": "npm",
  "args": ["test"],
  "cwd": "/path/to/project",
  "timeout": 60000,
  "env": {
    "NODE_ENV": "test"
  }
}
```

**Output:**
```json
{
  "exitCode": 0,
  "stdout": "All tests passed\n",
  "stderr": "",
  "duration_ms": 5432
}
```

**Security:**
- Commands must match the allowlist
- Commands matching the denylist are always blocked
- Timeout enforced (default 60s)
- Working directory scoped to workspace

## Tool Errors

All tools return errors in a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { "additional": "context" }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `PATH_OUTSIDE_WORKSPACE` | Path is outside configured workspace |
| `PATH_DENIED` | Path matches deny pattern |
| `PERMISSION_DENIED` | Operation not allowed for tier |
| `FILE_NOT_FOUND` | File or directory not found |
| `COMMAND_NOT_ALLOWED` | Command not in allowlist |
| `COMMAND_DENIED` | Command matches deny pattern |
| `TIMEOUT` | Operation timed out |
| `INTERNAL_ERROR` | Unexpected error |

## Tool Schemas

All tools define JSON schemas for input validation. Invalid inputs return an error before execution.

Example schema for `fs.read`:

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute path to file"
    },
    "encoding": {
      "type": "string",
      "enum": ["utf-8", "base64"],
      "default": "utf-8"
    },
    "startLine": {
      "type": "integer",
      "minimum": 1
    },
    "endLine": {
      "type": "integer",
      "minimum": 1
    }
  },
  "required": ["path"]
}
```

## Calling Tools

### Via CLI

```bash
mzd tool call fs.list --args '{"path": "/tmp"}'
```

### Via Client

```typescript
const client = new LocalAgentClient({ host, port, token });
await client.connect();

const result = await client.callTool("fs.read", {
  path: "/path/to/file.ts",
});

console.log(result.result.content);
```

### Via Orchestrator

```typescript
const runner = createTaskRunner(ctx, logger);

const result = await runner.callTool("git.status", {
  path: "/path/to/repo",
});
```
