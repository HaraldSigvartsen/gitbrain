import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runStatus } from "../src/commands/status.js";
import { BRAIN_DIR, LEDGER_FILE, type Ledger } from "../src/brain.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-"));
}

describe("brain status", () => {
  it("fails with a helpful error before brain init", () => {
    const project = tmpProject();
    expect(() => runStatus(project)).toThrow(/brain init/u);
  });

  it("reports a freshly initialised brain", () => {
    const project = tmpProject();
    runInit(project);
    const status = runStatus(project);

    expect(status.project).toBe(basename(project));
    expect(status.lastReconciledSha).toBeNull();
    expect(status.decisions).toEqual({});
    expect(status.observations).toEqual({});
    expect(status.files.every((f) => f.present)).toBe(true);
  });

  it("counts ledger entries by status and reports missing files", () => {
    const project = tmpProject();
    runInit(project);

    const ledgerPath = join(project, BRAIN_DIR, LEDGER_FILE);
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
    ledger.decisions = [
      { id: "D-0001", title: "Use Vitest", status: "active", updated: "2026-10-21T09:00:00Z" },
      { id: "D-0002", title: "Try Jest", status: "superseded", updated: "2026-10-20T09:00:00Z" },
      { id: "D-0003", title: "Old build tool", status: "closed", updated: "2026-10-19T09:00:00Z" },
    ];
    ledger.observations = [
      { id: "O-0001", title: "Flaky test", status: "open", updated: "2026-10-21T09:00:00Z" },
    ];
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    writeFileSync(join(project, BRAIN_DIR, "HANDOFF.md"), ""); // still present
    const status = runStatus(project);
    expect(status.decisions).toEqual({ active: 1, superseded: 1, closed: 1 });
    expect(status.observations).toEqual({ open: 1 });
  });
});
