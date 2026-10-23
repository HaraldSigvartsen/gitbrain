import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_DIR, DECISIONS_FILE, LEDGER_FILE, OBSERVATIONS_FILE } from "../src/brain.js";
import {
  formatHealHumanOutput,
  healResultToJson,
  runHeal,
} from "../src/commands/heal.js";
import { runInit } from "../src/commands/init.js";
import { readLedger } from "../src/commands/status.js";
import { ensureDistBuilt } from "./ensure-dist.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-heal-cmd-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function commitAll(repo: string, message: string): string {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-m", message], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

function seedObservation(repo: string): void {
  writeFileSync(
    join(repo, BRAIN_DIR, OBSERVATIONS_FILE),
    `# proj — observations

## O-0001 — Race in checkout queue
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** \`src/checkout/queue.ts\`
- **Found:** 2026-01-01
- **Detail:** Consumer races under load

---
`,
    "utf8",
  );
  const ledger = readLedger(repo);
  ledger.observations = [
    {
      id: "O-0001",
      title: "Race in checkout queue",
      status: "open",
      updated: "2026-01-01",
    },
  ];
  writeFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

describe("runHeal", () => {
  it("closes a drifted observation and formats README-style output", () => {
    const repo = tmpRepo();
    runInit(repo, new Date("2026-10-22T12:00:00.000Z"));
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove queue");

    const result = runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });
    expect(result.apply.changes).toHaveLength(1);
    expect(result.apply.changes[0].id).toBe("O-0001");

    const text = formatHealHumanOutput(result);
    expect(text).toContain("Reconciling .brain against git since");
    expect(text).toContain('✓ O-0001  "Race in checkout queue"');
    expect(text).toContain("→ closed");
    expect(text).toContain("src/checkout/queue.ts");
    expect(text).toContain("Wrote memory drift report → .brain/reports/2026-10-22.md");

    expect(readLedger(repo).last_reconciled_sha).not.toBe(base);
  });

  it("is idempotent: second heal makes no changes", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });
    const obsAfterFirst = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    const ledgerAfterFirst = readFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), "utf8");

    const second = runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });
    expect(second.apply.changes).toHaveLength(0);
    expect(second.apply.advancedReconciledSha).toBe(false);
    expect(formatHealHumanOutput(second)).toContain("(memory is up to date)");

    expect(readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8")).toBe(obsAfterFirst);
    expect(readFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), "utf8")).toBe(ledgerAfterFirst);
  });

  it("dry-run reports planned changes without writing", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const before = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    const result = runHeal(repo, { dryRun: true });
    expect(result.apply.changes).toHaveLength(1);
    expect(formatHealHumanOutput(result)).toContain("Dry run — no files written.");
    expect(readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8")).toBe(before);
    expect(readLedger(repo).last_reconciled_sha).toBeNull();
  });

  it("exports JSON payload with drift summary", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const json = healResultToJson(runHeal(repo, { dryRun: true }));
    expect(json.dryRun).toBe(true);
    expect(json.changes[0].id).toBe("O-0001");
    expect(json.commitCount).toBeGreaterThan(0);
    expect(json.headSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("brain heal CLI", () => {
  let cliPath: string;

  beforeAll(() => {
    cliPath = ensureDistBuilt();
  });

  it("runs end-to-end via dist/cli.js", () => {

    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const first = execFileSync("node", [cliPath, "heal", repo], { encoding: "utf8" });
    expect(first).toContain("→ closed");
    expect(first).toContain("Wrote memory drift report");

    const second = execFileSync("node", [cliPath, "heal", repo], { encoding: "utf8" });
    expect(second).toContain("(memory is up to date)");

    const json = JSON.parse(
      execFileSync("node", [cliPath, "heal", repo, "--json", "--dry-run"], { encoding: "utf8" }),
    ) as { changes: unknown[] };
    expect(json.changes).toHaveLength(0);
  });
});
