import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedBrain } from "../src/brain/parse.js";
import { collectChangeSet } from "../src/git/diff.js";
import { detectDrift, isHeavyRewriteChange } from "../src/heal/detect.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-heal-"));
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

function brain(
  partial: Partial<ParsedBrain> & Pick<ParsedBrain, "observations" | "decisions">,
): ParsedBrain {
  return {
    contextPaths: partial.contextPaths ?? [],
    ledgerMismatches: partial.ledgerMismatches ?? [],
    observations: partial.observations,
    decisions: partial.decisions,
  };
}

describe("detectDrift", () => {
  it("proposes closing an open observation when its Where path was deleted", () => {
    const repo = tmpRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "gone.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "gone.ts"));
    commitAll(repo, "remove");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [
          {
            id: "O-0001",
            title: "Bug in gone module",
            status: "open",
            where: ["src/gone.ts"],
          },
        ],
        decisions: [],
      }),
    );

    expect(report.closeCandidates).toEqual([
      {
        observationId: "O-0001",
        title: "Bug in gone module",
        reason: "path_deleted",
        paths: ["src/gone.ts"],
        detail: "src/gone.ts was deleted in the reconciled range",
      },
    ]);
    expect(report.supersedeCandidates).toEqual([]);
  });

  it("proposes re-pointing an observation Where path when the file was renamed", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "old.ts"), "a\n");
    const base = commitAll(repo, "seed");
    execFileSync("git", ["mv", "old.ts", "new.ts"], { cwd: repo });
    commitAll(repo, "rename");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [
          {
            id: "O-0001",
            title: "Issue in old file",
            status: "open",
            where: ["old.ts"],
          },
        ],
        decisions: [],
      }),
    );

    expect(report.closeCandidates).toEqual([]);
    expect(report.observationRepoints).toEqual([
      {
        observationId: "O-0001",
        title: "Issue in old file",
        fromPath: "old.ts",
        toPath: "new.ts",
        detail: "old.ts was renamed to new.ts",
      },
    ]);
  });

  it("proposes re-pointing CONTEXT paths instead of marking them stale after a rename", () => {
    const repo = tmpRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "old.ts"), "a\n");
    const base = commitAll(repo, "seed");
    execFileSync("git", ["mv", join(repo, "src", "old.ts"), join(repo, "src", "new.ts")], {
      cwd: repo,
    });
    commitAll(repo, "rename");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [],
        decisions: [],
        contextPaths: ["src/old.ts"],
      }),
    );

    expect(report.staleContextPaths).toEqual([]);
    expect(report.contextRepoints).toEqual([
      {
        fromPath: "src/old.ts",
        toPath: "src/new.ts",
        detail: "src/old.ts was renamed to src/new.ts",
      },
    ]);
  });

  it("proposes superseding an active decision when a subject path was heavily rewritten", () => {
    const repo = tmpRepo();
    const target = join(repo, "src", "session.ts");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(target, `${"line\n".repeat(20)}`);
    const base = commitAll(repo, "seed");
    writeFileSync(target, `${"other\n".repeat(20)}`);
    commitAll(repo, "rewrite");

    const changeSet = collectChangeSet(repo, base);
    const file = changeSet.files.find((f) => f.path === "src/session.ts");
    expect(file).toBeDefined();
    expect(isHeavyRewriteChange(file!)).toBe(true);

    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [],
        decisions: [
          {
            id: "D-0001",
            title: "Sessions in Durable Objects",
            status: "active",
            subjectPaths: ["src/session.ts"],
          },
        ],
      }),
    );

    expect(report.supersedeCandidates).toHaveLength(1);
    expect(report.supersedeCandidates[0]?.decisionId).toBe("D-0001");
    expect(report.supersedeCandidates[0]?.reason).toBe("subject_heavily_rewritten");
  });

  it("flags stale CONTEXT paths missing at HEAD or deleted in range", () => {
    const repo = tmpRepo();
    mkdirSync(join(repo, "src", "legacy"), { recursive: true });
    writeFileSync(join(repo, "src", "legacy", "api.ts"), "x\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "src", "legacy", "api.ts"));
    commitAll(repo, "drop legacy");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [],
        decisions: [],
        contextPaths: ["src/legacy/api.ts", "src/never-existed.ts"],
      }),
    );

    expect(report.staleContextPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/legacy/api.ts", reason: "deleted_in_range" }),
        expect.objectContaining({ path: "src/never-existed.ts", reason: "missing_at_head" }),
      ]),
    );
  });

  it("does not flag bare brain-file names as missing when .brain/ holds them (O-0001)", () => {
    const repo = tmpRepo();
    mkdirSync(join(repo, ".brain"), { recursive: true });
    writeFileSync(join(repo, ".brain", "brain.json"), "{}\n");
    writeFileSync(join(repo, "real.ts"), "x\n");
    const base = commitAll(repo, "seed");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [],
        decisions: [],
        contextPaths: ["brain.json", "real.ts", "ghost.md"],
      }),
    );

    expect(report.staleContextPaths).toEqual([
      expect.objectContaining({ path: "ghost.md", reason: "missing_at_head" }),
    ]);
  });

  it("returns no candidates when the brain matches a healthy repo", () => {
    const repo = tmpRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "ok.ts"), "ok\n");
    const base = commitAll(repo, "seed");
    writeFileSync(join(repo, "src", "ok.ts"), "ok2\n");
    commitAll(repo, "tiny tweak");

    const changeSet = collectChangeSet(repo, base);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        contextPaths: ["src/ok.ts"],
        observations: [
          {
            id: "O-0001",
            title: "Minor style",
            status: "open",
            where: ["src/ok.ts"],
          },
        ],
        decisions: [
          {
            id: "D-0001",
            title: "Keep module",
            status: "active",
            subjectPaths: ["src/ok.ts"],
          },
        ],
      }),
    );

    expect(report.closeCandidates).toEqual([]);
    expect(report.supersedeCandidates).toEqual([]);
    expect(report.staleContextPaths).toEqual([]);
  });

  it("passes through ledger mismatches from the parsed brain", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "a.txt"), "a\n");
    commitAll(repo, "init");

    const changeSet = collectChangeSet(repo, null);
    const report = detectDrift(
      repo,
      changeSet,
      brain({
        observations: [],
        decisions: [],
        ledgerMismatches: [
          {
            kind: "decision_missing_in_ledger",
            id: "D-0099",
            message: "D-0099 is in DECISIONS.md but not in brain.json",
          },
        ],
      }),
    );

    expect(report.ledgerMismatches).toHaveLength(1);
  });
});
