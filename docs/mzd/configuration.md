# Configuration

The mzd daemon uses a YAML configuration file located at `~/.mzd/config.yaml`.

## Configuration File

```yaml
# Configuration version (required)
version: 1

# Default workspace to use
defaultWorkspace: my-project

# Workspace definitions
workspaces:
  - name: my-project
    path: /home/user/projects/my-project
    tier: write  # read | write | exec
    denyPaths:
      - "**/.env"
      - "**/node_modules/**"
      - "**/.git/objects/**"

# Server settings
server:
  host: "127.0.0.1"  # Bind address
  port: 3847         # WebSocket port
  transport: http    # http or stdio

# Approval settings
approval:
  mode: prompt       # prompt | auto | deny
  timeout: 120       # Seconds to wait for approval
  dangerPatterns:
    - "rm -rf"
    - "DROP TABLE"

# Logging
logging:
  level: info        # debug | info | warn | error
  jsonLogs: false    # Use JSON format
  timestamps: true   # Include timestamps
  logDir: ~/.mzd/logs

# Command allowlist (regex patterns)
commandAllowlist:
  - "^npm (run|test|install)"
  - "^pnpm (run|test|install)"
  - "^git (status|log|diff|branch)"
  - "^pytest"
  - "^make"

# Command denylist (always denied, regex patterns)
commandDenylist:
  - "\\brm\\s+-rf\\s+/"
  - "\\bsudo\\b"
  - "curl.*\\|.*sh"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MZD_CONFIG` | Custom config file path |
| `MZD_TOKEN` | Override auth token |
| `MZD_LOG_LEVEL` | Override log level |
| `MZD_WORKSPACE` | Override default workspace |

## Workspaces

### Permission Tiers

| Tier | Description |
|------|-------------|
| `read` | Read-only access to files and git info |
| `write` | Read + write files and git operations |
| `exec` | Read + write + command execution |

### Deny Paths

Block access to sensitive files using glob patterns:

```yaml
denyPaths:
  - "**/.env"           # Environment files
  - "**/.env.*"
  - "**/secrets/**"     # Secrets directory
  - "**/*.pem"          # Private keys
  - "**/*.key"
  - "**/node_modules/**"  # Dependencies
  - "**/.git/objects/**"  # Git internals
```

## Approval Modes

| Mode | Behavior |
|------|----------|
| `prompt` | Interactive approval for write operations |
| `auto` | Auto-approve (use with caution) |
| `deny` | Deny all write operations |

## Command Security

### Allowlist

Only commands matching allowlist patterns can be executed:

```yaml
commandAllowlist:
  - "^npm (run|test|build|install)"
  - "^git (status|log|diff|add|commit)"
  - "^pytest\\b"
  - "^make\\b"
```

### Denylist

These patterns are always blocked, even if allowlisted:

```yaml
commandDenylist:
  - "\\brm\\s+-rf\\s+/"      # Recursive delete from root
  - "\\bsudo\\b"              # Privilege escalation
  - "curl.*\\|.*sh"           # Piping to shell
  - "\\bchmod\\s+777\\b"      # Overly permissive
  - "\\bkill\\s+-9\\b"        # Force kill
```

## Server Settings

### Host Binding

- `127.0.0.1` - Localhost only (recommended)
- `0.0.0.0` - All interfaces (requires additional security)

### Transport Modes

| Mode | Description |
|------|-------------|
| `http` | WebSocket over HTTP (default for daemon) |
| `stdio` | Standard input/output (for MCP integration) |

## Logging

### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Verbose debugging information |
| `info` | Normal operational messages |
| `warn` | Warning conditions |
| `error` | Error conditions only |

### Log Files

Logs are written to:
- Console (unless `--quiet`)
- `~/.mzd/logs/{runId}.log` (run logs)
- `~/.mzd/audit/{runId}.jsonl` (audit trail)

## Initialize Configuration

Create a default configuration:

```bash
mzd init --workspace /path/to/project
```

This creates:
- `~/.mzd/config.yaml` - Configuration file
- `~/.mzd/token` - Authentication token
- `~/.mzd/logs/` - Log directory
