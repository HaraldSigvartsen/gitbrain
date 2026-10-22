import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_DIR, LEDGER_FILE, OBSERVATIONS_FILE } from "../src/brain.js";
import { runHeal } from "../src/commands/heal.js";
import { runInit } from "../src/commands/init.js";
import { readLedger } from "../src/commands/status.js";
import { brainPathsWrittenByHeal } from "../src/git/commit-brain.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-heal-commit-"));
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

describe("brain heal --commit", () => {
  it("creates a git commit that only contains .brain/ files", () => {
    const repo = tmpRepo();
    runInit(repo, new Date("2026-10-22T12:00:00.000Z"));
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const beforeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    const result = runHeal(repo, {
      commit: true,
      now: new Date("2026-10-22T12:00:00.000Z"),
    });
    expect(result.commit?.committed).toBe(true);
    expect(result.commit?.message).toMatch(/^chore\(brain\):/);

    const afterHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    expect(afterHead).not.toBe(beforeHead);

    const files = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.every((f) => f.startsWith(".brain/"))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it("does not commit when heal makes no file changes", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });
    const headAfterHeal = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    const second = runHeal(repo, { commit: true, now: new Date("2026-10-22T12:00:00.000Z") });
    expect(second.commit?.committed).toBe(false);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()).toBe(
      headAfterHeal,
    );
  });

  it("rejects --commit with --dry-run", () => {
    const repo = tmpRepo();
    runInit(repo);
    expect(() => runHeal(repo, { dryRun: true, commit: true })).toThrow(/dry-run/i);
  });

  it("refuses to commit when non-.brain/ files are already staged", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");
    writeFileSync(join(repo, "src", "other.ts"), "y\n");
    execFileSync("git", ["add", "src/other.ts"], { cwd: repo });

    expect(() =>
      runHeal(repo, { commit: true, now: new Date("2026-10-22T12:00:00.000Z") }),
    ).toThrow(/already staged/i);
  });

  it("lists only heal-written paths for staging", () => {
    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const result = runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });
    const paths = brainPathsWrittenByHeal(repo, result.apply);
    expect(paths.every((p) => p.startsWith(".brain/"))).toBe(true);
    expect(paths).toContain(".brain/OBSERVATIONS.md");
    expect(paths).toContain(".brain/brain.json");
  });
});

describe("brain heal --commit CLI", () => {
  const cliPath = join(import.meta.dirname, "../dist/cli.js");

  it("runs heal --commit via dist/cli.js", () => {
    execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
    if (!existsSync(cliPath)) {
      throw new Error("dist/cli.js missing after build");
    }

    const repo = tmpRepo();
    runInit(repo);
    seedObservation(repo);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    writeFileSync(join(repo, "src", "checkout", "queue.ts"), "x\n");
    commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "checkout", "queue.ts"));
    commitAll(repo, "remove");

    const out = execFileSync("node", [cliPath, "heal", repo, "--commit"], { encoding: "utf8" });
    expect(out).toContain("Committed heal changes →");
    expect(out).toContain("chore(brain):");

    const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo, encoding: "utf8" });
    expect(subject.trim()).toMatch(/^chore\(brain\):/);
  });
});
