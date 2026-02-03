# Orchestrator

The mzd orchestrator manages task execution with safety, cost control, and traceability. It coordinates sub-agents, enforces limits, and provides structured output.

## Priority Stack

1. **Safety** - Never break production, leak secrets, or bypass guardrails
2. **Cost Control** - Stay within token/call budgets; escalate only when justified
3. **Correctness** - Verify facts before acting; admit uncertainty
4. **Traceability** - Every action logged; every claim backed by evidence

## Limits

The orchestrator enforces hard limits on all runs:

| Limit | Default | Description |
|-------|---------|-------------|
| `maxSteps` | 12 | Maximum planning/execution steps |
| `maxToolCalls` | 20 | Maximum tool invocations |
| `maxRetriesPerTool` | 2 | Retries before giving up on a tool |
| `maxSecondsPerStep` | 60 | Timeout per step |
| `maxOutputBytesReturned` | 16KB | Output truncation limit |

## Model Routing

The orchestrator uses two modes:

### CHEAP Mode (Default)

- Fast, cost-effective model
- Used for routine operations
- Code search, simple analysis, test runs

### PREMIUM Mode (Escalation)

Triggered by:
- **High Stakes** - Production, security, infrastructure, customer-facing output
- **Ambiguity** - Conflicting signals or missing context
- **Failures** - Invalid schema or repeated failures (>2)
- **Complexity** - More than 6 tool calls or >2 subsystems involved
- **Final Output** - Content sent to stakeholders

## Sub-Agents

The orchestrator can dispatch to specialized agents:

| Agent | Purpose |
|-------|---------|
| `ContextBuilder` | Gathers relevant context from the codebase |
| `LogAnalyst` | Extracts errors and patterns from logs |
| `ChangePlanner` | Proposes implementation plans |
| `PatchGenerator` | Generates code patches (does not apply) |
| `TestRunner` | Runs test suites |
| `StaticAnalysis` | Runs linters and type checks |
| `RiskReviewer` | Identifies risks and security concerns |
| `Reporter` | Produces structured reports |

### Agent Results

All agents return structured results:

```typescript
interface AgentResult {
  success: boolean;
  summary: string;
  data?: Record<string, unknown>;
  artifactPath?: string;
  error?: string;
}
```

## Checkpoint Flow

Write operations require explicit approval:

```
1. Orchestrator detects write operation in goal
2. Creates checkpoint with:
   - Proposed action
   - Commands to execute
   - Diff preview
   - Identified risks
   - Verification steps
3. Returns checkpoint (requiresApproval: true)
4. User reviews and approves/denies
5. On approval: execute and verify
6. On denial: task ends
```

### Checkpoint Structure

```typescript
interface Checkpoint {
  type: "checkpoint";
  proposedAction: string;
  commands?: string[];
  diff?: string;
  risks: string[];
  verification: string[];
  requiresApproval: true;
}
```

## Structured Output

All runs produce structured output:

```typescript
interface StructuredOutput {
  runId: string;
  status: "success" | "failure" | "checkpoint" | "needs_input";
  tldr: string[];           // 3-6 bullet summary
  findings: string[];       // Detailed findings
  evidence: Evidence[];     // Source citations
  nextActions: string[];    // Recommended next steps
  risks: string[];          // Identified risks
  artifactPaths: string[];  // Generated artifacts
  confidence: number;       // 0-1 confidence score
  stats: {
    steps: number;
    toolCalls: number;
    durationMs: number;
    modelMode: "cheap" | "premium";
  };
}
```

### Evidence Format

```typescript
interface Evidence {
  source: string;           // File path or URL
  lineRange?: [number, number];
  excerpt: string;          // Relevant snippet
  relevance: string;        // Why this is evidence
}
```

## Usage

### Basic Task Execution

```typescript
import { createTaskRunner } from "openclaw/mzd";

const runner = createTaskRunner(runContext, logger);

const result = await runner.execute({
  goal: "Analyze authentication flow",
  readOnly: true,
});

if (isCheckpoint(result)) {
  // Handle approval request
  console.log("Approval needed:", result.proposedAction);
} else {
  // Handle structured output
  console.log("TL;DR:", result.tldr);
  console.log("Confidence:", result.confidence);
}
```

### Custom Limits

```typescript
const result = await runner.execute({
  goal: "Fix the bug in user registration",
  limits: {
    maxSteps: 8,
    maxToolCalls: 15,
  },
});
```

### With Explicit Plan

```typescript
const result = await runner.execute({
  goal: "Add input validation to API endpoints",
  plan: [
    "Identify all API endpoints",
    "Add validation schemas",
    "Update endpoint handlers",
    "Add tests for validation",
  ],
});
```

## CLI Usage

### Run a task

```bash
mzd run "Analyze codebase structure"
```

### Run with custom limits

```bash
mzd run --max-steps 5 "Find security vulnerabilities"
```

### View run history

```bash
mzd runs list
```

### View run details

```bash
mzd runs show <run-id>
```

## Audit Trail

All operations are logged to:
- Run log: `artifacts/{runId}/run-log.md`
- Audit log: `~/.mzd/audit/{runId}.jsonl`

The audit log includes:
- Every tool call with input/output
- Approval decisions
- Patches applied
- Commands executed
- Errors encountered
