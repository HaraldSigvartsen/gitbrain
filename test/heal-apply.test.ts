import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRAIN_DIR,
  CONTEXT_FILE,
  DECISIONS_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
} from "../src/brain.js";
import { parseBrain } from "../src/brain/parse.js";
import { runInit } from "../src/commands/init.js";
import { readLedger } from "../src/commands/status.js";
import { collectChangeSet } from "../src/git/diff.js";
import { applyDriftReport } from "../src/heal/apply.js";
import { detectDrift } from "../src/heal/detect.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-apply-"));
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
  const obsPath = join(repo, BRAIN_DIR, OBSERVATIONS_FILE);
  const content = `# proj — observations

## O-0001 — Bug in gone module
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** \`src/gone.ts\`
- **Found:** 2026-01-01
- **Detail:** Something broken

---
`;
  writeFileSync(obsPath, content, "utf8");
  const ledger = readLedger(repo);
  ledger.observations = [
    {
      id: "O-0001",
      title: "Bug in gone module",
      status: "open",
      updated: "2026-01-01",
    },
  ];
  writeFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

describe("applyDriftReport", () => {
  it("closes an observation in markdown and ledger, writes report, advances SHA", () => {
    const repo = tmpRepo();
    runInit(repo, new Date("2026-10-22T12:00:00.000Z"));
    seedObservation(repo);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "gone.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "gone.ts"));
    const head = commitAll(repo, "remove");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(repo, changeSet, parseBrain(repo));
    const result = applyDriftReport(repo, report, {
      now: new Date("2026-10-22T12:00:00.000Z"),
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].id).toBe("O-0001");
    expect(result.advancedReconciledSha).toBe(true);
    expect(result.reportPath).toBe(join(repo, BRAIN_DIR, "reports", "2026-10-22.md"));

    const obs = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    expect(obs).toContain("- **Status:** fixed");
    expect(obs).toContain("> healed 2026-10-22 — src/gone.ts was deleted in the reconciled range");

    const ledger = readLedger(repo);
    expect(ledger.last_reconciled_sha).toBe(head);
    expect(ledger.observations[0].status).toBe("fixed");

    const driftReport = readFileSync(result.reportPath!, "utf8");
    expect(driftReport).toContain("O-0001");
    expect(driftReport).toContain("src/gone.ts");
  });

  it("is idempotent when applied twice with the same drift", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "gone.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "gone.ts"));
    commitAll(repo, "remove");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(repo, changeSet, parseBrain(repo));
    applyDriftReport(repo, report, { now: new Date("2026-10-22T12:00:00.000Z") });

    const obsAfterFirst = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    const ledgerAfterFirst = readFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), "utf8");

    const second = applyDriftReport(repo, report, { now: new Date("2026-10-22T12:00:00.000Z") });
    expect(second.changes).toHaveLength(0);
    expect(second.advancedReconciledSha).toBe(false);

    expect(readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8")).toBe(obsAfterFirst);
    expect(readFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), "utf8")).toBe(ledgerAfterFirst);
  });

  it("dry-run returns planned changes without writing files", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "gone.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "gone.ts"));
    commitAll(repo, "remove");

    const report = detectDrift(repo, collectChangeSet(repo, base), parseBrain(repo));
    const beforeObs = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    const result = applyDriftReport(repo, report, { dryRun: true });

    expect(result.changes).toHaveLength(1);
    expect(result.wroteObservations).toBe(true);
    expect(readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8")).toBe(beforeObs);
    expect(readLedger(repo).last_reconciled_sha).toBeNull();
  });

  it("re-points observation Where paths and annotates without closing", () => {
    const repo = tmpRepo();
    runInit(repo);
    writeFileSync(
      join(repo, BRAIN_DIR, OBSERVATIONS_FILE),
      `# proj — observations

## O-0001 — Issue in old file
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** \`old.ts\`
- **Found:** 2026-01-01
- **Detail:** Still relevant

---
`,
      "utf8",
    );
    const ledger = readLedger(repo);
    ledger.observations = [
      { id: "O-0001", title: "Issue in old file", status: "open", updated: "2026-01-01" },
    ];
    writeFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");

    writeFileSync(join(repo, "old.ts"), "a\n");
    const base = commitAll(repo, "seed");
    execFileSync("git", ["mv", "old.ts", "new.ts"], { cwd: repo });
    commitAll(repo, "rename");

    const report = detectDrift(repo, collectChangeSet(repo, base), parseBrain(repo));
    const result = applyDriftReport(repo, report, { now: new Date("2026-10-24T00:00:00.000Z") });

    expect(result.changes[0].kind).toBe("observation_repointed");
    const obs = readFileSync(join(repo, BRAIN_DIR, OBSERVATIONS_FILE), "utf8");
    expect(obs).toContain("- **Status:** open");
    expect(obs).toContain("- **Where:** `new.ts`");
    expect(obs).toContain("> healed 2026-10-24 — old.ts was renamed to new.ts");
    expect(readLedger(repo).observations[0].status).toBe("open");
  });

  it("re-points CONTEXT.md backtick paths after a rename", () => {
    const repo = tmpRepo();
    runInit(repo);
    const contextPath = join(repo, BRAIN_DIR, CONTEXT_FILE);
    writeFileSync(
      contextPath,
      `# proj — context

See \`src/old.ts\` for the module.

`,
      "utf8",
    );
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "old.ts"), "x\n");
    const base = commitAll(repo, "seed");
    execFileSync("git", ["mv", join(repo, "src", "old.ts"), join(repo, "src", "new.ts")], {
      cwd: repo,
    });
    commitAll(repo, "rename");

    const report = detectDrift(repo, collectChangeSet(repo, base), parseBrain(repo));
    applyDriftReport(repo, report, { now: new Date("2026-10-24T00:00:00.000Z") });

    const context = readFileSync(contextPath, "utf8");
    expect(context).toContain("`src/new.ts`");
    expect(context).not.toContain("`src/old.ts`");
    expect(context).toContain("> healed 2026-10-24 — src/old.ts was renamed to src/new.ts");
  });

  it("supersedes a decision and records it in the drift report", () => {
    const repo = tmpRepo();
    runInit(repo);
    const decisionsPath = join(repo, BRAIN_DIR, DECISIONS_FILE);
    writeFileSync(
      decisionsPath,
      `# proj — decisions

## D-0001 — Sessions in KV
- **Date:** 2026-01-01
- **Status:** active
- **Context:** Use \`config/session.ts\` for sessions
- **Choice:** KV store
- **Consequences:** none

---
`,
      "utf8",
    );
    const ledger = readLedger(repo);
    ledger.decisions = [
      { id: "D-0001", title: "Sessions in KV", status: "active", updated: "2026-01-01" },
    ];
    writeFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");

    mkdirSync(join(repo, "config"), { recursive: true });
    const target = join(repo, "config", "session.ts");
    writeFileSync(target, `${"line\n".repeat(20)}`);
    const base = commitAll(repo, "seed");
    writeFileSync(target, `${"other\n".repeat(20)}`);
    commitAll(repo, "rewrite");

    const report = detectDrift(repo, collectChangeSet(repo, base), parseBrain(repo));
    const result = applyDriftReport(repo, report, { now: new Date("2026-10-23T00:00:00.000Z") });

    expect(result.changes[0].kind).toBe("decision_superseded");
    const md = readFileSync(decisionsPath, "utf8");
    expect(md).toContain("- **Status:** superseded");
    expect(md).toContain("> healed 2026-10-23 —");
    expect(readLedger(repo).decisions[0].status).toBe("superseded");
  });
});
