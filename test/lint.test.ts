import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintBrain } from "../src/brain/lint.js";
import {
  formatLintHumanOutput,
  lintResultToJson,
  runLint,
} from "../src/commands/lint.js";
import { runInit } from "../src/commands/init.js";
import { readLedger } from "../src/commands/status.js";
import { BRAIN_DIR, DECISIONS_FILE, LEDGER_FILE } from "../src/brain.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-lint-"));
}

function appendDecision(project: string, block: string): void {
  const path = join(project, BRAIN_DIR, DECISIONS_FILE);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n${block}\n`, "utf8");
}

const VALID_DECISION = `## D-0001 — First decision
- **Date:** 2026-01-01
- **Status:** active
- **Context:** why
- **Choice:** what
- **Consequences:** effects
`;

describe("lintBrain", () => {
  it("passes on a fresh init project", () => {
    const project = tmpProject();
    runInit(project);
    const result = lintBrain(project);
    expect(result.issues).toEqual([]);
    expect(result.errorCount).toBe(0);
  });

  it("passes on this repo's .brain", () => {
    const repoRoot = join(import.meta.dirname, "..");
    const result = lintBrain(repoRoot);
    expect(result.issues).toEqual([]);
  });

  it("reports duplicate markdown IDs", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(project, VALID_DECISION);
    appendDecision(project, VALID_DECISION);

    const kinds = lintBrain(project).issues.map((i) => i.kind);
    expect(kinds).toContain("duplicate_id_markdown");
  });

  it("reports sequence gaps in markdown", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `## D-0002 — Skip one
- **Date:** 2026-01-02
- **Status:** active
- **Context:** c
- **Choice:** c
- **Consequences:** c
`,
    );

    const issues = lintBrain(project).issues;
    expect(issues.some((i) => i.kind === "sequence_gap" && i.id === "D-0001")).toBe(true);
  });

  it("reports missing required fields", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `## D-0001 — Incomplete
- **Status:** active
`,
    );

    const issues = lintBrain(project).issues;
    expect(issues.some((i) => i.kind === "missing_field" && i.id === "D-0001")).toBe(true);
  });

  it("reports wrong-prefix headings in the wrong file", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `## O-0001 — Wrong file
- **Priority:** MINOR
- **Status:** open
- **Where:** \`a.ts\`
- **Found:** 2026-01-01
- **Detail:** x
`,
    );

    const issues = lintBrain(project).issues;
    expect(issues.some((i) => i.kind === "wrong_prefix_in_file")).toBe(true);
  });

  it("reports ledger mismatches for unregistered markdown entries", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(project, VALID_DECISION);

    const issues = lintBrain(project).issues;
    expect(issues.some((i) => i.kind === "ledger_mismatch")).toBe(true);
    expect(formatLintHumanOutput({ projectDir: project, issues, errorCount: issues.length })).toContain(
      "error(s)",
    );
  });

  it("reports duplicate IDs in brain.json", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(project, VALID_DECISION);
    const ledger = readLedger(project);
    ledger.decisions.push({
      id: "D-0001",
      title: "First decision",
      status: "active",
      updated: "2026-01-01",
    });
    ledger.decisions.push({
      id: "D-0001",
      title: "First decision",
      status: "active",
      updated: "2026-01-01",
    });
    writeFileSync(join(project, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n");

    const issues = lintBrain(project).issues;
    expect(issues.some((i) => i.kind === "duplicate_id_ledger")).toBe(true);
  });

  it("exports JSON with ok flag", () => {
    const project = tmpProject();
    runInit(project);
    expect(lintResultToJson(runLint(project))).toEqual({
      ok: true,
      errorCount: 0,
      issues: [],
    });
  });
});

describe("brain lint CLI", () => {
  const cliPath = join(import.meta.dirname, "../dist/cli.js");

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
    if (!existsSync(cliPath)) {
      throw new Error("dist/cli.js missing after build");
    }
  });

  it("exits 0 on clean project and 1 when lint fails", () => {
    const project = tmpProject();
    runInit(project);
    execFileSync("node", [cliPath, "lint", project], { encoding: "utf8" });

    appendDecision(project, VALID_DECISION);
    let threw = false;
    try {
      execFileSync("node", [cliPath, "lint", project], { encoding: "utf8" });
    } catch (error: unknown) {
      threw = true;
      const err = error as { status?: number; stderr?: string; stdout?: string };
      expect(err.status).toBe(1);
      const combined = String(err.stderr ?? "") + String(err.stdout ?? "");
      expect(combined).toContain("error(s)");
    }
    expect(threw).toBe(true);

    let jsonStdout = "";
    try {
      execFileSync("node", [cliPath, "lint", project, "--json"], { encoding: "utf8" });
    } catch (error: unknown) {
      const err = error as { stdout?: string; status?: number };
      expect(err.status).toBe(1);
      jsonStdout = String(err.stdout);
    }
    const json = JSON.parse(jsonStdout) as { ok: boolean };
    expect(json.ok).toBe(false);
  });
});
