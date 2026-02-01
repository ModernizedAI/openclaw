#!/usr/bin/env node
/**
 * mzd CLI entry point
 *
 * ModernizedAI Local Agent Runner
 * A secure MCP server for local agent operations
 */

import { runMzdCli } from "./cli/main.js";

runMzdCli().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
