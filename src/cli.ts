#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { formatHealHumanOutput, healResultToJson, runHeal } from "./commands/heal.js";
import { runInit } from "./commands/init.js";
import { runStatus } from "./commands/status.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("brain")
  .description(
    "Self-healing project memory for AI coding agents.\n" +
      "Agents write it. Git proves it. `brain heal` keeps it true.",
  )
  .version(VERSION);

program
  .command("init")
  .description("Create a .brain/ memory directory in a project (refuses if one already exists).")
  .argument("[dir]", "project directory", ".")
  .action((dir: string) => {
    const result = runInit(resolve(dir));
    console.log(`\n🧠 Created ${result.created.length} memory files in ${result.dir}`);
    for (const name of result.created) console.log(`   · ${name}`);
    console.log(`
Next steps:
  1. Commit .brain/ — memory is meant to be shared, diffed and reviewed.
  2. Point your agents at it (see "Tell your agents" in the README).
  3. Run \`brain status\` any time to see the ledger.
`);
  });

program
  .command("heal")
  .description("Reconcile .brain/ memory against git history (detect drift and apply fixes).")
  .argument("[dir]", "project directory", ".")
  .option("--dry-run", "print the drift report without writing files")
  .option("--commit", "commit only .brain/ changes after applying (local commit, never pushes)")
  .option("--json", "emit machine-readable JSON on stdout")
  .action((dir: string, options: { dryRun?: boolean; commit?: boolean; json?: boolean }) => {
    const projectDir = resolve(dir);
    const result = runHeal(projectDir, { dryRun: options.dryRun, commit: options.commit });
    if (options.json) {
      console.log(JSON.stringify(healResultToJson(result), null, 2));
      return;
    }
    console.log("\n" + formatHealHumanOutput(result));
  });

program
  .command("status")
  .description("Show a project's memory ledger summary.")
  .argument("[dir]", "project directory", ".")
  .action((dir: string) => {
    const status = runStatus(resolve(dir));
    const summarise = (counts: Record<string, number>) => {
      const parts = Object.entries(counts).map(([state, n]) => `${n} ${state}`);
      return parts.length ? parts.join(", ") : "none yet";
    };
    const missing = status.files.filter((f) => !f.present).map((f) => f.name);

    console.log(`\n🧠 ${status.project}`);
    console.log(`   created:       ${status.created}`);
    console.log(`   last healed:   ${status.lastReconciledSha ?? "never"}`);
    console.log(`   decisions:     ${summarise(status.decisions)}`);
    console.log(`   observations:  ${summarise(status.observations)}`);
    console.log(
      `   files:         ${missing.length ? `⚠ missing ${missing.join(", ")}` : "all present"}\n`,
    );
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
});
