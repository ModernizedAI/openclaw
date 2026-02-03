/**
 * mzd client command - Test connection to a running daemon
 */

import { Command } from "commander";
import { loadToken, getTokenPath } from "../../auth/token.js";
import { LocalAgentClient } from "../../client/daemon-client.js";

export interface ClientOptions {
  host?: string;
  port?: number;
  token?: string;
  verbose?: boolean;
}

export function registerClientCommand(program: Command): void {
  const clientCmd = program
    .command("client")
    .description("Test connection to a local agent daemon");

  // client connect
  clientCmd
    .command("connect")
    .description("Connect to the daemon and display info")
    .option("--host <host>", "Daemon host", "127.0.0.1")
    .option("-p, --port <port>", "Daemon port", parseInt)
    .option("-t, --token <token>", "Auth token (reads from file if not specified)")
    .option("-v, --verbose", "Verbose output")
    .action(async (opts: ClientOptions) => {
      await connectCommand(opts);
    });

  // client tools
  clientCmd
    .command("tools")
    .description("List available tools from the daemon")
    .option("--host <host>", "Daemon host", "127.0.0.1")
    .option("-p, --port <port>", "Daemon port", parseInt)
    .option("-t, --token <token>", "Auth token")
    .option("-v, --verbose", "Verbose output")
    .action(async (opts: ClientOptions) => {
      await toolsCommand(opts);
    });

  // client call
  clientCmd
    .command("call <tool>")
    .description("Call a tool on the daemon")
    .option("--host <host>", "Daemon host", "127.0.0.1")
    .option("-p, --port <port>", "Daemon port", parseInt)
    .option("-t, --token <token>", "Auth token")
    .option("-a, --args <json>", "Tool arguments as JSON", "{}")
    .option("-v, --verbose", "Verbose output")
    .action(async (tool: string, opts: ClientOptions & { args?: string }) => {
      await callCommand(tool, opts);
    });

  // client ping
  clientCmd
    .command("ping")
    .description("Ping the daemon")
    .option("--host <host>", "Daemon host", "127.0.0.1")
    .option("-p, --port <port>", "Daemon port", parseInt)
    .option("-t, --token <token>", "Auth token")
    .action(async (opts: ClientOptions) => {
      await pingCommand(opts);
    });
}

async function getClient(opts: ClientOptions): Promise<LocalAgentClient> {
  const host = opts.host || "127.0.0.1";
  const port = opts.port || 3847;

  let token = opts.token;
  if (!token) {
    const savedToken = await loadToken();
    if (savedToken) {
      token = savedToken;
    } else {
      console.error(`No token provided and none found at ${getTokenPath()}`);
      console.error("Use --token or start a daemon with 'mzd serve --show-token'");
      process.exit(1);
    }
  }

  return new LocalAgentClient({
    host,
    port,
    token,
    clientName: "mzd-cli",
  });
}

async function connectCommand(opts: ClientOptions): Promise<void> {
  const client = await getClient(opts);

  try {
    console.log("Connecting to daemon...");
    const { workspace, tools } = await client.connect();

    console.log("");
    console.log("Connected!");
    console.log("");
    console.log("Workspace:");
    console.log(`  Name: ${workspace.name}`);
    console.log(`  Path: ${workspace.path}`);
    console.log(`  Tier: ${workspace.tier}`);
    console.log("");
    console.log(`Available tools: ${tools.length}`);

    if (opts.verbose) {
      console.log("");
      for (const tool of tools) {
        console.log(`  - ${tool.name}`);
        console.log(`    ${tool.description}`);
        console.log(`    Tier: ${tool.tier}`);
      }
    }

    client.close();
  } catch (error) {
    console.error(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function toolsCommand(opts: ClientOptions): Promise<void> {
  const client = await getClient(opts);

  try {
    await client.connect();
    const tools = await client.listTools();

    console.log("Available tools:");
    console.log("");

    for (const tool of tools) {
      console.log(`${tool.name}`);
      console.log(`  ${tool.description}`);
      console.log(`  Tier: ${tool.tier}`);

      if (opts.verbose) {
        console.log(`  Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
      }

      console.log("");
    }

    client.close();
  } catch (error) {
    console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function callCommand(tool: string, opts: ClientOptions & { args?: string }): Promise<void> {
  const client = await getClient(opts);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(opts.args || "{}");
  } catch {
    console.error("Invalid JSON for --args");
    process.exit(1);
  }

  try {
    await client.connect();

    if (opts.verbose) {
      console.log(`Calling ${tool} with args:`, JSON.stringify(args, null, 2));
    }

    const result = await client.callTool(tool, args);

    console.log("Result:");
    console.log(JSON.stringify(result.result, null, 2));
    console.log("");
    console.log(`Duration: ${result.duration_ms}ms`);
    console.log(`Call ID: ${result.toolCallId}`);

    client.close();
  } catch (error) {
    console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function pingCommand(opts: ClientOptions): Promise<void> {
  const client = await getClient(opts);

  try {
    await client.connect();
    const start = Date.now();
    const ok = await client.ping();
    const duration = Date.now() - start;

    if (ok) {
      console.log(`Pong! (${duration}ms)`);
    } else {
      console.log("Ping failed");
      process.exit(1);
    }

    client.close();
  } catch (error) {
    console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
