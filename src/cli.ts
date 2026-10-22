#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEDGER_FILE, brainDir } from "./brain.js";
import { askResultToJson, formatAskHumanOutput, runAsk } from "./commands/ask.js";
import { formatHealHumanOutput, healResultToJson, runHeal } from "./commands/heal.js";
import { formatLintHumanOutput, lintResultToJson, runLint } from "./commands/lint.js";
import { parseAgentToolsList } from "./agents/emit.js";
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
  .option(
    "--agents <tools>",
    "comma-separated agent tools to scaffold (cursor, codex, claude, zcode, opencode)",
  )
  .action((dir: string, options: { agents?: string }) => {
    const agents = options.agents ? parseAgentToolsList(options.agents) : undefined;
    const result = runInit(resolve(dir), undefined, { agents });
    if (result.created.length) {
      console.log(`\n🧠 Created ${result.created.length} memory files in ${result.dir}`);
      for (const name of result.created) console.log(`   · ${name}`);
    } else if (result.agentFiles.length) {
      console.log(`\n🧠 ${result.dir} already exists — updated agent snippets only.`);
    }
    for (const file of result.agentFiles) {
      console.log(`   · ${file.path} (${file.action})`);
    }
    console.log(`
Next steps:
  1. Commit .brain/ — memory is meant to be shared, diffed and reviewed.
  2. Point your agents at it (see docs/agents.md or use \`brain init --agents\`).
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
  .command("ask")
  .description("Search project memory offline (deterministic keyword retrieval over .brain/).")
  .argument("[dir]", "project directory", ".")
  .argument("<query...>", "words to search for")
  .option("--all", "also search sibling projects under the same parent directory")
  .option("--limit <n>", "maximum number of hits to show", (value) => Number.parseInt(value, 10))
  .option("--json", "emit machine-readable JSON on stdout")
  .action(
    (
      dir: string,
      queryParts: string[],
      options: { all?: boolean; limit?: number; json?: boolean },
    ) => {
      const dirArg = resolve(dir);
      const dirHasBrain = existsSync(join(brainDir(dirArg), LEDGER_FILE));
      const projectDir =
        dirHasBrain && queryParts.length > 0 ? dirArg : resolve(".");
      const query =
        dirHasBrain && queryParts.length > 0
          ? queryParts.join(" ")
          : [dir === "." ? "" : dir, ...queryParts].filter(Boolean).join(" ");
      const result = runAsk(projectDir, query.trim(), { all: options.all, limit: options.limit });
      if (options.json) {
        console.log(JSON.stringify(askResultToJson(result), null, 2));
        return;
      }
      console.log("\n" + formatAskHumanOutput(result) + "\n");
    },
  );

program
  .command("lint")
  .description("Validate .brain/ markdown entries against brain.json (format and ledger consistency).")
  .argument("[dir]", "project directory", ".")
  .option("--json", "emit machine-readable JSON on stdout")
  .action((dir: string, options: { json?: boolean }) => {
    const projectDir = resolve(dir);
    const result = runLint(projectDir);
    if (options.json) {
      console.log(JSON.stringify(lintResultToJson(result), null, 2));
    } else {
      console.log("\n" + formatLintHumanOutput(result));
    }
    if (result.errorCount > 0) {
      process.exit(1);
    }
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
