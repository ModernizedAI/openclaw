# ModernizedAI Local Agent Runner (mzd)

The **mzd** daemon is a local agent runner that provides secure tool execution for OpenClaw. It runs on a client device and exposes safe local capabilities via WebSocket, allowing cloud orchestrators to request tool actions securely.

## Features

- **Secure local tool execution** - Filesystem, git, and command tools with workspace scoping
- **WebSocket daemon** - Low-latency communication with token-based authentication
- **Approval gates** - Checkpoint system for write operations requiring explicit approval
- **Orchestrator** - Task execution with safety limits, cost control, and traceability
- **Audit logging** - Complete traceability of all tool calls and operations

## Quick Start

### Initialize a workspace

```bash
mzd init --workspace /path/to/project
```

### Start the daemon

```bash
mzd serve --show-token
```

### Test the connection

```bash
mzd client connect --token <your-token>
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  OpenClaw Cloud                         │
│                                                         │
│  ┌─────────────┐      ┌─────────────────────────────┐  │
│  │   Gateway   │─────▶│      LocalAgentClient       │  │
│  └─────────────┘      └─────────────────────────────┘  │
│                                    │                    │
└────────────────────────────────────│────────────────────┘
                                     │ WebSocket
                                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Local Device                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              LocalAgentDaemon                    │   │
│  │                                                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │  │   Auth   │  │  Tools   │  │ Orchestrator │  │   │
│  │  │  Token   │  │ Executor │  │   + Agents   │  │   │
│  │  └──────────┘  └──────────┘  └──────────────┘  │   │
│  │                                                  │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │              Workspace                    │  │   │
│  │  │   /path/to/project (scoped access)        │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Security Model

### Authentication

The daemon uses token-based authentication with:
- 256-bit cryptographically random tokens
- Timing-safe comparison to prevent timing attacks
- Token stored in `~/.mzd/token`

### Workspace Scoping

All file operations are scoped to configured workspaces:
- Path validation prevents directory traversal
- Deny lists block access to sensitive paths
- Permission tiers control read/write/exec access

### Permission Tiers

| Tier | Allowed Operations |
|------|-------------------|
| `read` | fs.list, fs.read, git.status, git.log, git.diff |
| `write` | All read + fs.write, fs.apply_patch, git.* |
| `exec` | All write + cmd.run |

## CLI Commands

| Command | Description |
|---------|-------------|
| `mzd init` | Initialize configuration and workspaces |
| `mzd serve` | Start the local agent daemon |
| `mzd client` | Test connection to a running daemon |
| `mzd tool` | List or call tools directly |
| `mzd run` | Execute a task through the orchestrator |
| `mzd runs` | View run history and logs |
| `mzd workspace` | Manage workspaces |
| `mzd config` | View and modify configuration |

## Next Steps

- [CLI Reference](/mzd/cli) - Full command documentation
- [Configuration](/mzd/configuration) - Config file reference
- [Tools](/mzd/tools) - Available tools and schemas
- [Orchestrator](/mzd/orchestrator) - Task execution and agents
