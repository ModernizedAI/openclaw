/**
 * mzd serve command - Start the local agent daemon
 */

import { Command } from "commander";
import { loadConfig, getWorkspace } from "../../config/loader.js";
import { createRunContext } from "../../runtime/context.js";
import { createLogger } from "../../runtime/logger.js";
import { LocalAgentDaemon } from "../../server/daemon.js";
import { getOrCreateToken, regenerateToken, getTokenPath } from "../../auth/token.js";

export interface ServeOptions {
  workspace?: string;
  host?: string;
  port?: number;
  verbose?: boolean;
  newToken?: boolean;
  showToken?: boolean;
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the local agent daemon")
    .option("-w, --workspace <name>", "Workspace to serve")
    .option("--host <host>", "Host to bind to (default: 127.0.0.1)")
    .option("-p, --port <port>", "Port to listen on (default: 3847)", parseInt)
    .option("-v, --verbose", "Enable verbose logging")
    .option("--new-token", "Generate a new auth token")
    .option("--show-token", "Display the auth token on startup")
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

        // Get or create auth token
        const authToken = opts.newToken ? await regenerateToken() : await getOrCreateToken();

        // Create run context
        const ctx = createRunContext(config, workspace, {
          traceMode: opts.verbose,
        });

        // Create logger
        const logger = createLogger(ctx.runId, config.logging, {
          verbose: opts.verbose,
        });

        // Merge server options
        const serverConfig = {
          ...config.server,
          ...(opts.host && { host: opts.host }),
          ...(opts.port && { port: opts.port }),
          transport: "http" as const, // Daemon uses WebSocket over HTTP
        };

        // Display connection info
        console.log("");
        console.log("Local Agent Daemon");
        console.log("==================");
        console.log(`Workspace:   ${workspace.name}`);
        console.log(`Path:        ${workspace.path}`);
        console.log(`Tier:        ${workspace.tier}`);
        console.log(`Host:        ${serverConfig.host}`);
        console.log(`Port:        ${serverConfig.port}`);
        console.log(`Token file:  ${getTokenPath()}`);

        if (opts.showToken) {
          console.log(`Auth token:  ${authToken}`);
        } else {
          console.log(`Auth token:  (use --show-token to display)`);
        }

        console.log("");
        console.log("Connect with:");
        console.log(`  ws://${serverConfig.host}:${serverConfig.port}`);
        console.log("");

        logger.info(`Starting local agent daemon for workspace: ${workspace.name}`, {
          path: workspace.path,
          tier: workspace.tier,
        });

        // Create and start daemon
        const daemon = new LocalAgentDaemon(ctx, logger, serverConfig, config, authToken);

        // Handle shutdown
        const shutdown = async () => {
          console.log("\nShutting down...");
          await daemon.stop();
          await logger.flush();
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        await daemon.start();

        console.log("Daemon running. Press Ctrl+C to stop.");
      } catch (error) {
        console.error(
          `Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (process.env.DEBUG) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}
