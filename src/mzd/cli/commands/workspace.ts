/**
 * mzd workspace command - Manage workspaces
 */

import { Command } from "commander";
import path from "node:path";
import { loadConfig, saveConfig, addWorkspace, getWorkspace } from "../../config/loader.js";

export function registerWorkspaceCommand(program: Command): void {
  const wsCmd = program.command("workspace").alias("ws").description("Manage workspaces");

  // List workspaces
  wsCmd
    .command("list")
    .description("List configured workspaces")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = await loadConfig();

        if (opts.json) {
          console.log(JSON.stringify(config.workspaces, null, 2));
        } else {
          if (config.workspaces.length === 0) {
            console.log("No workspaces configured");
            console.log("Add one with: mzd workspace add <path>");
            return;
          }

          console.log("\nConfigured workspaces:\n");
          for (const ws of config.workspaces) {
            const isDefault = ws.name === config.defaultWorkspace;
            console.log(`  ${ws.name}${isDefault ? " (default)" : ""}`);
            console.log(`    Path: ${ws.path}`);
            console.log(`    Tier: ${ws.tier}`);
            console.log(`    Git:  ${ws.allowGit ? "enabled" : "disabled"}`);
            if (ws.denyPatterns.length > 0) {
              console.log(`    Deny: ${ws.denyPatterns.join(", ")}`);
            }
            console.log();
          }
        }
      } catch (error) {
        console.error(
          `Failed to list workspaces: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Add workspace
  wsCmd
    .command("add")
    .description("Add a workspace")
    .argument("<path>", "Path to workspace directory")
    .option("-n, --name <name>", "Workspace name (defaults to directory name)")
    .option("-t, --tier <tier>", "Permission tier (read, write, exec)", "read")
    .option("--default", "Set as default workspace")
    .action(
      async (workspacePath: string, opts: { name?: string; tier?: string; default?: boolean }) => {
        try {
          const tier = opts.tier as "read" | "write" | "exec";
          if (!["read", "write", "exec"].includes(tier)) {
            console.error("Invalid tier. Must be: read, write, or exec");
            process.exit(1);
          }

          await addWorkspace(workspacePath, {
            name: opts.name,
            tier,
            setDefault: opts.default,
          });

          const absolutePath = path.resolve(workspacePath);
          const name = opts.name || path.basename(absolutePath);

          console.log(`✓ Added workspace: ${name}`);
          console.log(`  Path: ${absolutePath}`);
          console.log(`  Tier: ${tier}`);
          if (opts.default) {
            console.log(`  Set as default workspace`);
          }
        } catch (error) {
          console.error(
            `Failed to add workspace: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      },
    );

  // Remove workspace
  wsCmd
    .command("remove")
    .description("Remove a workspace")
    .argument("<name>", "Workspace name to remove")
    .action(async (name: string) => {
      try {
        const config = await loadConfig();
        const result = getWorkspace(config, name);

        if (!result) {
          console.error(`Workspace not found: ${name}`);
          process.exit(1);
        }

        config.workspaces.splice(result.index, 1);

        // Clear default if it was the removed workspace
        if (config.defaultWorkspace === name) {
          config.defaultWorkspace = undefined;
        }

        await saveConfig(config);

        console.log(`✓ Removed workspace: ${name}`);
      } catch (error) {
        console.error(
          `Failed to remove workspace: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Set default workspace
  wsCmd
    .command("default")
    .description("Set or show default workspace")
    .argument("[name]", "Workspace name to set as default")
    .action(async (name?: string) => {
      try {
        const config = await loadConfig();

        if (!name) {
          if (config.defaultWorkspace) {
            console.log(`Default workspace: ${config.defaultWorkspace}`);
          } else {
            console.log("No default workspace set");
          }
          return;
        }

        const result = getWorkspace(config, name);
        if (!result) {
          console.error(`Workspace not found: ${name}`);
          process.exit(1);
        }

        config.defaultWorkspace = result.workspace.name;
        await saveConfig(config);

        console.log(`✓ Default workspace set to: ${result.workspace.name}`);
      } catch (error) {
        console.error(
          `Failed to set default: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Set workspace tier
  wsCmd
    .command("tier")
    .description("Set workspace permission tier")
    .argument("<name>", "Workspace name")
    .argument("<tier>", "Permission tier (read, write, exec)")
    .action(async (name: string, tier: string) => {
      try {
        if (!["read", "write", "exec"].includes(tier)) {
          console.error("Invalid tier. Must be: read, write, or exec");
          process.exit(1);
        }

        const config = await loadConfig();
        const result = getWorkspace(config, name);

        if (!result) {
          console.error(`Workspace not found: ${name}`);
          process.exit(1);
        }

        config.workspaces[result.index].tier = tier as "read" | "write" | "exec";
        await saveConfig(config);

        console.log(`✓ Set ${name} tier to: ${tier}`);
      } catch (error) {
        console.error(
          `Failed to set tier: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });
}
