/**
 * mzd run command - Run a task with the agent
 */

import { Command } from "commander";
import { loadConfig, getWorkspace } from "../../config/loader.js";
import { createRunContext, getRunSummary } from "../../runtime/context.js";
import { createLogger, writeAuditLog } from "../../runtime/logger.js";

export interface RunOptions {
  workspace?: string;
  trace?: boolean;
  maxTurns?: number;
  dryRun?: boolean;
  json?: boolean;
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a task with the agent")
    .argument("<task>", "Task description or prompt")
    .option("-w, --workspace <name>", "Workspace to use")
    .option("--trace", "Enable trace mode (verbose output)")
    .option("--max-turns <n>", "Maximum agent turns", parseInt, 100)
    .option("--dry-run", "Preview actions without executing")
    .option("--json", "Output as JSON")
    .action(async (task: string, opts: RunOptions) => {
      try {
        const config = await loadConfig();

        // Resolve workspace
        let workspaceName = opts.workspace || config.defaultWorkspace;

        if (!workspaceName) {
          if (config.workspaces.length === 0) {
            console.error("No workspaces configured. Run 'mzd init --workspace <path>' first.");
            process.exit(1);
          }
          workspaceName = config.workspaces[0].name;
        }

        const workspaceResult = getWorkspace(config, workspaceName);
        if (!workspaceResult) {
          console.error(`Workspace not found: ${workspaceName}`);
          process.exit(1);
        }

        const { workspace } = workspaceResult;

        // Create run context
        const ctx = createRunContext(config, workspace, {
          traceMode: opts.trace,
          maxTurns: opts.maxTurns,
        });

        // Create logger
        const logger = createLogger(ctx.runId, config.logging, {
          verbose: opts.trace,
          quiet: opts.json,
        });

        logger.info(`Starting run: ${ctx.runId}`, {
          workspace: workspace.name,
          task,
          maxTurns: ctx.maxTurns,
          dryRun: opts.dryRun,
        });

        // TODO: Implement actual agent loop
        // For now, just show the plan structure
        if (!opts.json) {
          console.log("\n┌─ Run Information");
          console.log(`│ Run ID:    ${ctx.runId}`);
          console.log(`│ Workspace: ${workspace.name} (${workspace.path})`);
          console.log(`│ Tier:      ${workspace.tier}`);
          console.log(`│ Task:      ${task}`);
          console.log("└─");

          if (opts.dryRun) {
            console.log("\n[DRY RUN] Would execute task but --dry-run is set");
          } else {
            console.log("\n[PLACEHOLDER] Agent loop not yet implemented");
            console.log("The MCP server is ready at: mzd serve --workspace " + workspace.name);
          }
        }

        // Get summary
        const summary = getRunSummary(ctx);

        // Write audit log
        if (ctx.auditLog.length > 0) {
          const logPath = await writeAuditLog(ctx.runId, ctx.auditLog);
          logger.info(`Audit log written to: ${logPath}`);
        }

        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log("\n┌─ Run Summary");
          console.log(`│ Duration:    ${summary.duration_ms}ms`);
          console.log(`│ Turns:       ${summary.turnCount}/${ctx.maxTurns}`);
          console.log(`│ Tool Calls:  ${summary.toolCalls}`);
          console.log(`│ Approvals:   ${summary.approvals}`);
          console.log(`│ Patches:     ${summary.patchesApplied}`);
          console.log(`│ Commands:    ${summary.commandsRun}`);
          console.log(`│ Errors:      ${summary.errors}`);
          console.log("└─");
        }

        await logger.flush();
      } catch (error) {
        console.error(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
        if (process.env.DEBUG) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}
