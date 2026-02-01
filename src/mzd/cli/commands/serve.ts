/**
 * mzd serve command - Start the MCP server
 */

import { Command } from "commander";
import { loadConfig, getWorkspace } from "../../config/loader.js";
import { createRunContext } from "../../runtime/context.js";
import { createLogger } from "../../runtime/logger.js";
import { MzdServer } from "../../server/mcp-server.js";

export interface ServeOptions {
  workspace?: string;
  host?: string;
  port?: number;
  transport?: "stdio" | "http";
  verbose?: boolean;
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the MCP server")
    .option("-w, --workspace <name>", "Workspace to serve")
    .option("--host <host>", "Host to bind to")
    .option("-p, --port <port>", "Port to listen on", parseInt)
    .option("-t, --transport <type>", "Transport type (stdio, http)", "stdio")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (opts: ServeOptions) => {
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
          console.error("Available workspaces:");
          for (const ws of config.workspaces) {
            console.error(`  - ${ws.name} (${ws.path})`);
          }
          process.exit(1);
        }

        const { workspace } = workspaceResult;

        // Create run context
        const ctx = createRunContext(config, workspace, {
          traceMode: opts.verbose,
        });

        // Create logger
        const logger = createLogger(ctx.runId, config.logging, {
          verbose: opts.verbose,
        });

        logger.info(`Starting MCP server for workspace: ${workspace.name}`, {
          path: workspace.path,
          tier: workspace.tier,
        });

        // Merge server options
        const serverConfig = {
          ...config.server,
          ...(opts.host && { host: opts.host }),
          ...(opts.port && { port: opts.port }),
          ...(opts.transport && { transport: opts.transport }),
        };

        // Create and start server
        const server = new MzdServer(ctx, logger, serverConfig);

        // Handle shutdown
        const shutdown = async () => {
          logger.info("Shutting down...");
          await server.stop();
          await logger.flush();
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        await server.start();
      } catch (error) {
        console.error(
          `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (process.env.DEBUG) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}
