/**
 * Main CLI entry point for mzd
 */

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerRunCommand } from "./commands/run.js";
import { registerToolCommand } from "./commands/tool.js";
import { registerRunsCommand } from "./commands/runs.js";
import { registerWorkspaceCommand } from "./commands/workspace.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerClientCommand } from "./commands/client.js";

/**
 * Build the mzd CLI program
 */
export function buildMzdProgram(): Command {
  const program = new Command();

  program
    .name("mzd")
    .description("ModernizedAI Local Agent Runner - A secure MCP server for local agent operations")
    .version("0.1.0");

  // Register all commands
  registerInitCommand(program);
  registerServeCommand(program);
  registerRunCommand(program);
  registerToolCommand(program);
  registerRunsCommand(program);
  registerWorkspaceCommand(program);
  registerConfigCommand(program);
  registerClientCommand(program);

  return program;
}

/**
 * Run the CLI
 */
export async function runMzdCli(args: string[] = process.argv): Promise<void> {
  const program = buildMzdProgram();

  try {
    await program.parseAsync(args);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}
