import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { BRAIN_DIR, BRAIN_FILES, LEDGER_FILE, type Ledger } from "../src/brain.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-"));
}

describe("brain init", () => {
  it("creates .brain/ with all five memory files", () => {
    const project = tmpProject();
    const result = runInit(project);

    expect(result.project).toBe(basename(project));
    expect(result.created).toEqual([...BRAIN_FILES]);
    for (const name of BRAIN_FILES) {
      expect(existsSync(join(project, BRAIN_DIR, name)), name).toBe(true);
    }
  });

  it("writes a valid empty ledger", () => {
    const project = tmpProject();
    runInit(project, new Date("2026-10-21T10:30:00Z"));

    const ledger = JSON.parse(
      readFileSync(join(project, BRAIN_DIR, LEDGER_FILE), "utf8"),
    ) as Ledger;
    expect(ledger).toEqual({
      version: 1,
      project: basename(project),
      created: "2026-10-21T10:30:00.000Z",
      last_reconciled_sha: null,
      decisions: [],
      observations: [],
    });
  });

  it("prefers the package.json name, with scope stripped", () => {
    const project = tmpProject();
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "@scope/my-lib" }));
    expect(runInit(project).project).toBe("my-lib");
  });

  it("falls back to the directory name when package.json is unparseable", () => {
    const project = tmpProject();
    writeFileSync(join(project, "package.json"), "{ not json");
    expect(runInit(project).project).toBe(basename(project));
  });

  it("refuses to overwrite an existing .brain/", () => {
    const project = tmpProject();
    runInit(project);
    expect(() => runInit(project)).toThrow(/already exists/u);
  });
});
