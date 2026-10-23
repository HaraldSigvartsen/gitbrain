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
import { createTheme, shouldUseColor } from "./cli/theme.js";
import { VERSION } from "./version.js";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;

export interface GlobalCliOptions {
  quiet?: boolean;
  color?: boolean;
}

const program = new Command();

function globalOpts(): GlobalCliOptions {
  return program.opts<GlobalCliOptions>();
}

function themeFromGlobals(): ReturnType<typeof createTheme> {
  return createTheme(shouldUseColor({ color: globalOpts().color }));
}

program
  .name("brain")
  .description(
    "Self-healing project memory for AI coding agents.\n" +
      "Agents write it. Git proves it. `brain heal` keeps it true.",
  )
  .version(VERSION)
  .option("-q, --quiet", "suppress routine stdout (errors still print; --json always emits)")
  .option("--color", "force ANSI colours even when stdout is not a TTY")
  .option("--no-color", "disable ANSI colours");

program
  .command("init")
  .description("Create a .brain/ memory directory in a project (refuses if one already exists).")
  .argument("[dir]", "project directory", ".")
  .option(
    "--agents <tools>",
    "comma-separated agent tools to scaffold (cursor, codex, claude, zcode, opencode)",
  )
  .action((dir: string, options: { agents?: string }) => {
    const { quiet } = globalOpts();
    const theme = themeFromGlobals();
    const agents = options.agents ? parseAgentToolsList(options.agents) : undefined;
    const result = runInit(resolve(dir), undefined, { agents });
    if (!quiet) {
      if (result.created.length) {
        console.log(`\n🧠 Created ${result.created.length} memory files in ${result.dir}`);
        for (const name of result.created) console.log(theme.dim(`   · ${name}`));
      } else if (result.agentFiles.length) {
        console.log(`\n🧠 ${result.dir} already exists — updated agent snippets only.`);
      }
      for (const file of result.agentFiles) {
        console.log(theme.dim(`   · ${file.path} (${file.action})`));
      }
      console.log(`
Next steps:
  1. Commit .brain/ — memory is meant to be shared, diffed and reviewed.
  2. Point your agents at it (see docs/agents.md or use \`brain init --agents\`).
  3. Run \`brain status\` any time to see the ledger.
`);
    }
  });

program
  .command("heal")
  .description("Reconcile .brain/ memory against git history (detect drift and apply fixes).")
  .argument("[dir]", "project directory", ".")
  .option("--dry-run", "print the drift report without writing files")
  .option("--commit", "commit only .brain/ changes after applying (local commit, never pushes)")
  .option("--json", "emit machine-readable JSON on stdout")
  .action((dir: string, options: { dryRun?: boolean; commit?: boolean; json?: boolean }) => {
    const { quiet } = globalOpts();
    const theme = themeFromGlobals();
    const projectDir = resolve(dir);
    const result = runHeal(projectDir, { dryRun: options.dryRun, commit: options.commit });
    if (options.json) {
      console.log(JSON.stringify(healResultToJson(result), null, 2));
      return;
    }
    if (!quiet) {
      console.log("\n" + formatHealHumanOutput(result, theme));
    }
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
      const { quiet } = globalOpts();
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
        if (result.hits.length === 0) {
          process.exit(EXIT_FAIL);
        }
        return;
      }
      if (result.hits.length === 0) {
        if (!quiet) {
          console.log("\n" + formatAskHumanOutput(result) + "\n");
        }
        process.exit(EXIT_FAIL);
      }
      if (!quiet) {
        console.log("\n" + formatAskHumanOutput(result) + "\n");
      }
    },
  );

program
  .command("lint")
  .description("Validate .brain/ markdown entries against brain.json (format and ledger consistency).")
  .argument("[dir]", "project directory", ".")
  .option("--json", "emit machine-readable JSON on stdout")
  .action((dir: string, options: { json?: boolean }) => {
    const { quiet } = globalOpts();
    const theme = themeFromGlobals();
    const projectDir = resolve(dir);
    const result = runLint(projectDir);
    if (options.json) {
      console.log(JSON.stringify(lintResultToJson(result), null, 2));
    } else if (!quiet || result.errorCount > 0) {
      const text = formatLintHumanOutput(result, theme);
      if (result.errorCount > 0) {
        console.error("\n" + text);
      } else {
        console.log("\n" + text);
      }
    }
    if (result.errorCount > 0) {
      process.exit(EXIT_FAIL);
    }
  });

program
  .command("status")
  .description("Show a project's memory ledger summary.")
  .argument("[dir]", "project directory", ".")
  .action((dir: string) => {
    const { quiet } = globalOpts();
    const theme = themeFromGlobals();
    if (quiet) return;
    const status = runStatus(resolve(dir));
    const summarise = (counts: Record<string, number>) => {
      const parts = Object.entries(counts).map(([state, n]) => `${n} ${state}`);
      return parts.length ? parts.join(", ") : "none yet";
    };
    const missing = status.files.filter((f) => !f.present).map((f) => f.name);

    console.log(`\n🧠 ${status.project}`);
    console.log(theme.dim(`   created:       ${status.created}`));
    console.log(theme.dim(`   last healed:   ${status.lastReconciledSha ?? "never"}`));
    console.log(theme.dim(`   decisions:     ${summarise(status.decisions)}`));
    console.log(theme.dim(`   observations:  ${summarise(status.observations)}`));
    const filesDetail = missing.length
      ? `${theme.warning("⚠")} missing ${missing.join(", ")}`
      : "all present";
    console.log(`   files:         ${theme.dim(filesDetail)}\n`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const theme = themeFromGlobals();
  console.error(`\n${theme.error("✖")} ${message}\n`);
  process.exit(EXIT_FAIL);
});
