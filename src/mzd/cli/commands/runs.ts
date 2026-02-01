/**
 * mzd runs command - View run history and logs
 */

import { Command } from "commander";
import { listRunLogs, readAuditLog } from "../../runtime/logger.js";

export function registerRunsCommand(program: Command): void {
  const runsCmd = program.command("runs").description("View run history and logs");

  // List runs
  runsCmd
    .command("list")
    .description("List recent runs")
    .option("-n, --limit <n>", "Number of runs to show", parseInt, 20)
    .option("--json", "Output as JSON")
    .action(async (opts: { limit: number; json?: boolean }) => {
      try {
        const logs = await listRunLogs();
        const limited = logs.slice(0, opts.limit);

        if (opts.json) {
          console.log(JSON.stringify(limited, null, 2));
        } else {
          if (limited.length === 0) {
            console.log("No runs found");
            return;
          }

          console.log("\nRecent runs:\n");
          for (const log of limited) {
            console.log(`  ${log.runId}`);
            console.log(`    Time: ${log.timestamp.toISOString()}`);
            console.log(`    Size: ${(log.size / 1024).toFixed(1)}KB`);
            console.log();
          }
        }
      } catch (error) {
        console.error(
          `Failed to list runs: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  // Show specific run
  runsCmd
    .command("show")
    .description("Show details of a specific run")
    .argument("<run-id>", "Run ID to show")
    .option("--json", "Output as JSON")
    .action(async (runId: string, opts: { json?: boolean }) => {
      try {
        const entries = await readAuditLog(runId);

        if (entries.length === 0) {
          console.error(`No audit log found for run: ${runId}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(`\n─── Run: ${runId} ───\n`);

          for (const entry of entries) {
            const time = new Date(entry.timestamp).toISOString();
            console.log(`[${time}] ${entry.type.toUpperCase()}`);

            if (entry.tool) {
              console.log(`  Tool: ${entry.tool}`);
            }

            if (entry.input) {
              console.log(`  Input: ${JSON.stringify(entry.input)}`);
            }

            if (entry.output) {
              console.log(`  Output: ${JSON.stringify(entry.output)}`);
            }

            if (entry.approved !== undefined) {
              console.log(`  Approved: ${entry.approved}`);
            }

            if (entry.error) {
              console.log(`  Error: ${entry.error}`);
            }

            if (entry.duration_ms !== undefined) {
              console.log(`  Duration: ${entry.duration_ms}ms`);
            }

            console.log();
          }
        }
      } catch (error) {
        console.error(
          `Failed to show run: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });
}
