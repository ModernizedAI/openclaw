/**
 * mzd config command - View and edit configuration
 */

import { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "../../config/loader.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command("config").description("View and edit configuration");

  // Show config path
  configCmd
    .command("path")
    .description("Show config file path")
    .action(() => {
      console.log(getConfigPath());
    });

  // Show full config
  configCmd
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output as JSON (default)")
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = await loadConfig();
        console.log(JSON.stringify(config, null, 2));
      } catch (error) {
        console.error(
          `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Get a config value
  configCmd
    .command("get")
    .description("Get a config value")
    .argument("<key>", "Config key (dot notation, e.g., server.port)")
    .action(async (key: string) => {
      try {
        const config = await loadConfig();
        const parts = key.split(".");
        let value: unknown = config;

        for (const part of parts) {
          if (value && typeof value === "object" && part in value) {
            value = (value as Record<string, unknown>)[part];
          } else {
            console.error(`Key not found: ${key}`);
            process.exit(1);
          }
        }

        if (typeof value === "object") {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(String(value));
        }
      } catch (error) {
        console.error(
          `Failed to get config: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Set a config value
  configCmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", "Config key (dot notation)")
    .argument("<value>", "Value to set (JSON for objects/arrays)")
    .action(async (key: string, valueStr: string) => {
      try {
        const config = await loadConfig();
        const parts = key.split(".");
        const lastPart = parts.pop();

        if (!lastPart) {
          console.error("Invalid key");
          process.exit(1);
        }

        // Navigate to parent
        let parent: Record<string, unknown> = config as Record<string, unknown>;
        for (const part of parts) {
          if (!(part in parent) || typeof parent[part] !== "object") {
            parent[part] = {};
          }
          parent = parent[part] as Record<string, unknown>;
        }

        // Parse value
        let value: unknown;
        try {
          value = JSON.parse(valueStr);
        } catch {
          // Not JSON, treat as string
          value = valueStr;
        }

        parent[lastPart] = value;

        await saveConfig(config);
        console.log(`✓ Set ${key} = ${JSON.stringify(value)}`);
      } catch (error) {
        console.error(
          `Failed to set config: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Add to command allowlist
  configCmd
    .command("allow")
    .description("Add a command pattern to the allowlist")
    .argument("<pattern>", "Regex pattern for allowed commands")
    .action(async (pattern: string) => {
      try {
        // Validate regex
        try {
          new RegExp(pattern);
        } catch {
          console.error("Invalid regex pattern");
          process.exit(1);
        }

        const config = await loadConfig();
        if (!config.commands.allow.includes(pattern)) {
          config.commands.allow.push(pattern);
          await saveConfig(config);
          console.log(`✓ Added to allowlist: ${pattern}`);
        } else {
          console.log(`Pattern already in allowlist: ${pattern}`);
        }
      } catch (error) {
        console.error(
          `Failed to update allowlist: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Add to command denylist
  configCmd
    .command("deny")
    .description("Add a command pattern to the denylist")
    .argument("<pattern>", "Regex pattern for denied commands")
    .action(async (pattern: string) => {
      try {
        // Validate regex
        try {
          new RegExp(pattern);
        } catch {
          console.error("Invalid regex pattern");
          process.exit(1);
        }

        const config = await loadConfig();
        if (!config.commands.deny.includes(pattern)) {
          config.commands.deny.push(pattern);
          await saveConfig(config);
          console.log(`✓ Added to denylist: ${pattern}`);
        } else {
          console.log(`Pattern already in denylist: ${pattern}`);
        }
      } catch (error) {
        console.error(
          `Failed to update denylist: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });
}
