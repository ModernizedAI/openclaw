/**
 * mzd tool command - Debug tool calls directly
 */

import { Command } from "commander";
import { loadConfig, getWorkspace } from "../../config/loader.js";
import { createRunContext } from "../../runtime/context.js";
import { createLogger } from "../../runtime/logger.js";
import { TOOL_DEFINITIONS, type ToolName, isToolError } from "../../tools/types.js";
import { executeTool } from "../../tools/executor.js";

export interface ToolOptions {
  workspace?: string;
  json?: boolean;
}

export function registerToolCommand(program: Command): void {
  const toolCmd = program.command("tool").description("Debug tool calls directly");

  // List available tools
  toolCmd
    .command("list")
    .description("List available tools")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        console.log(JSON.stringify(TOOL_DEFINITIONS, null, 2));
      } else {
        console.log("\nAvailable tools:\n");
        for (const tool of TOOL_DEFINITIONS) {
          console.log(`  ${tool.name}`);
          console.log(`    ${tool.description}`);
          console.log(`    Tier: ${tool.tier}, Approval: ${tool.requiresApproval ? "yes" : "no"}`);
          console.log();
        }
      }
    });

  // Call a specific tool
  toolCmd
    .command("call")
    .description("Call a tool with JSON input")
    .argument("<tool>", "Tool name (e.g., fs.list, fs.read)")
    .argument("<input>", "JSON input for the tool")
    .option("-w, --workspace <name>", "Workspace to use")
    .option("--json", "Output as JSON")
    .action(async (toolName: string, inputJson: string, opts: ToolOptions) => {
      try {
        // Validate tool name
        const toolDef = TOOL_DEFINITIONS.find((t) => t.name === toolName);
        if (!toolDef) {
          console.error(`Unknown tool: ${toolName}`);
          console.error("Available tools:", TOOL_DEFINITIONS.map((t) => t.name).join(", "));
          process.exit(1);
        }

        // Parse input
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(inputJson);
        } catch {
          console.error("Invalid JSON input");
          process.exit(1);
        }

        const config = await loadConfig();

        // Get workspace from input or options
        const workspaceName =
          (input.workspace as string) || opts.workspace || config.defaultWorkspace;

        if (!workspaceName) {
          console.error("No workspace specified. Use --workspace or include in input JSON.");
          process.exit(1);
        }

        const workspaceResult = getWorkspace(config, workspaceName);
        if (!workspaceResult) {
          console.error(`Workspace not found: ${workspaceName}`);
          process.exit(1);
        }

        const { workspace } = workspaceResult;

        // Create context and logger
        const ctx = createRunContext(config, workspace, { traceMode: true });
        const logger = createLogger(ctx.runId, config.logging, {
          verbose: true,
          quiet: opts.json,
        });

        // Execute tool
        const startTime = Date.now();
        const result = await executeTool(toolName as ToolName, input, ctx, logger);
        const duration = Date.now() - startTime;

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                tool: toolName,
                input,
                output: result,
                duration_ms: duration,
                isError: isToolError(result),
              },
              null,
              2,
            ),
          );
        } else {
          console.log("\n─── Tool Result ───");
          console.log(`Tool: ${toolName}`);
          console.log(`Duration: ${duration}ms`);
          console.log(`Status: ${isToolError(result) ? "ERROR" : "SUCCESS"}`);
          console.log("\nOutput:");
          console.log(JSON.stringify(result, null, 2));
        }

        await logger.flush();

        if (isToolError(result)) {
          process.exit(1);
        }
      } catch (error) {
        console.error(
          `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (process.env.DEBUG) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}
