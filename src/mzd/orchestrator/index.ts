/**
 * Orchestrator module - Task execution with safety, cost control, and traceability
 */

// Core orchestrator
export {
  type OrchestratorLimits,
  type OrchestratorContext,
  type RunStats,
  type EscalationTriggers,
  type ModelMode,
  type Evidence,
  type StructuredOutput,
  type Checkpoint,
  type RunLogEntry,
  DEFAULT_LIMITS,
  createOrchestratorContext,
  checkLimits,
  incrementStep,
  recordToolCall,
  hasExceededRetries,
  determineModelMode,
  escalateMode,
  createCheckpoint,
  buildStructuredOutput,
  truncateOutput,
  storeArtifact,
  logEntry,
  formatRunLog,
} from "./core.js";

// Sub-agents
export {
  type AgentResult,
  type AgentType,
  type AgentTask,
  type AgentHandler,
  type ContextBuilderResult,
  type LogAnalystResult,
  type ChangePlannerResult,
  type PatchGeneratorResult,
  type TestRunnerResult,
  type StaticAnalysisResult,
  type RiskReviewerResult,
  type ReporterResult,
  registerAgent,
  runAgent,
  runAgentsParallel,
  runAgentsSequence,
} from "./agents.js";

// Task runner
export {
  type Task,
  type TaskResult,
  TaskRunner,
  createTaskRunner,
  isCheckpoint,
} from "./runner.js";
