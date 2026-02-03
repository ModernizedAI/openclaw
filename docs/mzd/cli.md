# CLI Reference

The `mzd` command-line interface provides commands for managing the local agent daemon.

## Global Options

```
--help, -h     Show help
--version, -V  Show version
```

## Commands

### mzd init

Initialize mzd configuration and workspaces.

```bash
mzd init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <path>` | Path to workspace directory |
| `--name <name>` | Workspace name |
| `--tier <tier>` | Permission tier (read/write/exec) |
| `-f, --force` | Overwrite existing config |

**Examples:**

```bash
# Initialize with current directory
mzd init

# Initialize with specific workspace
mzd init --workspace /path/to/project --name my-project

# Initialize with exec tier
mzd init -w /path/to/project --tier exec
```

### mzd serve

Start the local agent daemon.

```bash
mzd serve [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <name>` | Workspace to serve |
| `--host <host>` | Host to bind to (default: 127.0.0.1) |
| `-p, --port <port>` | Port to listen on (default: 3847) |
| `-v, --verbose` | Enable verbose logging |
| `--new-token` | Generate a new auth token |
| `--show-token` | Display the auth token |

**Examples:**

```bash
# Start with default settings
mzd serve

# Start with custom port and show token
mzd serve -p 4000 --show-token

# Start with verbose logging
mzd serve -v

# Generate new token on startup
mzd serve --new-token --show-token
```

### mzd client

Test connection to a running daemon.

#### mzd client connect

Connect and display daemon info.

```bash
mzd client connect [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--host <host>` | Daemon host (default: 127.0.0.1) |
| `-p, --port <port>` | Daemon port (default: 3847) |
| `-t, --token <token>` | Auth token |
| `-v, --verbose` | Verbose output |

**Example:**

```bash
mzd client connect --show-token -v
```

#### mzd client tools

List available tools.

```bash
mzd client tools [options]
```

#### mzd client call

Call a tool on the daemon.

```bash
mzd client call <tool> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-a, --args <json>` | Tool arguments as JSON |
| `-v, --verbose` | Verbose output |

**Example:**

```bash
mzd client call fs.list --args '{"path": "/tmp"}'
```

#### mzd client ping

Ping the daemon.

```bash
mzd client ping
```

### mzd tool

Manage and call tools.

#### mzd tool list

List available tools.

```bash
mzd tool list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--tier <tier>` | Filter by permission tier |
| `-v, --verbose` | Show full schemas |

#### mzd tool call

Call a tool directly.

```bash
mzd tool call <name> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-a, --args <json>` | Tool arguments as JSON |
| `-w, --workspace <name>` | Workspace to use |

**Examples:**

```bash
# List files
mzd tool call fs.list -a '{"path": "/tmp"}'

# Read file
mzd tool call fs.read -a '{"path": "/etc/hosts"}'

# Git status
mzd tool call git.status -a '{"path": "."}'
```

### mzd run

Execute a task through the orchestrator.

```bash
mzd run <goal> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <name>` | Workspace to use |
| `--max-steps <n>` | Maximum steps |
| `--max-tool-calls <n>` | Maximum tool calls |
| `--read-only` | Prevent write operations |
| `-v, --verbose` | Verbose output |
| `-o, --output <format>` | Output format (json/text) |

**Examples:**

```bash
# Analyze codebase
mzd run "Analyze codebase structure"

# Find bugs with limits
mzd run --max-steps 5 "Find potential bugs"

# Read-only analysis
mzd run --read-only "Review security practices"
```

### mzd runs

View run history and logs.

#### mzd runs list

List recent runs.

```bash
mzd runs list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of runs to show (default: 10) |
| `--status <status>` | Filter by status |

#### mzd runs show

Show run details.

```bash
mzd runs show <run-id>
```

#### mzd runs log

Show run log.

```bash
mzd runs log <run-id>
```

### mzd workspace

Manage workspaces.

#### mzd workspace list

List configured workspaces.

```bash
mzd workspace list
```

#### mzd workspace add

Add a new workspace.

```bash
mzd workspace add <name> <path> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--tier <tier>` | Permission tier (read/write/exec) |
| `--deny <pattern>` | Deny path pattern (can repeat) |

**Example:**

```bash
mzd workspace add my-project /path/to/project --tier write --deny "**/.env"
```

#### mzd workspace remove

Remove a workspace.

```bash
mzd workspace remove <name>
```

#### mzd workspace set-default

Set the default workspace.

```bash
mzd workspace set-default <name>
```

### mzd config

View and modify configuration.

#### mzd config show

Show current configuration.

```bash
mzd config show
```

#### mzd config set

Set a configuration value.

```bash
mzd config set <key> <value>
```

**Examples:**

```bash
mzd config set server.port 4000
mzd config set logging.level debug
mzd config set approval.mode auto
```

#### mzd config path

Show configuration file path.

```bash
mzd config path
```

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Authentication error |
| 4 | Connection error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MZD_CONFIG` | Custom config file path |
| `MZD_TOKEN` | Override auth token |
| `MZD_LOG_LEVEL` | Override log level |
| `MZD_WORKSPACE` | Override default workspace |
| `DEBUG` | Enable debug output |
