/**
 * mzd init command
 */

import { Command } from "commander";
import path from "node:path";
import { initConfig, configExists, getConfigPath } from "../../config/loader.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize mzd configuration")
    .option("-w, --workspace <path>", "Initial workspace path")
    .option("-f, --force", "Overwrite existing config")
    .action(async (opts: { workspace?: string; force?: boolean }) => {
      const configPath = getConfigPath();

      // Check if config already exists
      if (!opts.force && (await configExists())) {
        console.log(`Config already exists at ${configPath}`);
        console.log("Use --force to overwrite");
        return;
      }

      try {
        const workspacePath = opts.workspace ? path.resolve(opts.workspace) : undefined;

        const { configPath: savedPath, config } = await initConfig(workspacePath);

        console.log(`✓ Created config at ${savedPath}`);

        if (config.workspaces.length > 0) {
          console.log(`✓ Added workspace: ${config.workspaces[0].name}`);
          console.log(`  Path: ${config.workspaces[0].path}`);
          console.log(`  Tier: ${config.workspaces[0].tier}`);
        }

        console.log("\nNext steps:");
        console.log("  1. Add workspaces: mzd workspace add <path>");
        console.log("  2. Start server:   mzd serve --workspace <name>");
        console.log("  3. Run a task:     mzd run --workspace <name> 'your task'");
      } catch (error) {
        console.error(
          `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });
}
