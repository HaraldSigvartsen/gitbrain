import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme, shouldUseColor } from "../src/cli/theme.js";
import { formatHealHumanOutput } from "../src/commands/heal.js";
import { runInit } from "../src/commands/init.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-cli-ux-"));
}

describe("cli theme", () => {
  it("disables colour by default when stdout is not a TTY", () => {
    expect(shouldUseColor()).toBe(false);
  });

  it("forces colour when requested", () => {
    expect(shouldUseColor({ color: true })).toBe(true);
    const text = formatHealHumanOutput(
      {
        projectDir: "/tmp",
        dryRun: true,
        report: {
          sinceSha: "abc",
          headSha: "def",
          commitCount: 0,
          capped: false,
          staleContextPaths: [],
          ledgerMismatches: [],
        },
        apply: {
          previousReconciledSha: null,
          advancedReconciledSha: false,
          reportPath: null,
          changes: [],
        },
        commit: null,
      },
      createTheme(true),
    );
    expect(text).toMatch(/\u001b\[/);
  });
});

describe("brain CLI UX", () => {
  const cliPath = join(import.meta.dirname, "../dist/cli.js");

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
    if (!existsSync(cliPath)) {
      throw new Error("dist/cli.js missing after build");
    }
  });

  it("does not emit ANSI escapes when stdout is piped", () => {
    const project = tmpProject();
    runInit(project);
    const stdout = execFileSync("node", [cliPath, "lint", project], { encoding: "utf8" });
    expect(stdout).not.toMatch(/\u001b\[/);
  });

  it("emits ANSI escapes with --color", () => {
    const project = tmpProject();
    runInit(project);
    const stdout = execFileSync("node", [cliPath, "--color", "lint", project], { encoding: "utf8" });
    expect(stdout).toMatch(/\u001b\[/);
  });

  it("--quiet suppresses routine init output", () => {
    const project = tmpProject();
    const stdout = execFileSync("node", [cliPath, "--quiet", "init", project], { encoding: "utf8" });
    expect(stdout).toBe("");
  });

  it("exits 1 for ask with no matches", () => {
    const project = tmpProject();
    runInit(project);
    const result = spawnSync("node", [cliPath, "ask", project, "qwertyuiop"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("No matches");
  });

  it("--quiet ask with no matches exits 1 without stdout", () => {
    const project = tmpProject();
    runInit(project);
    const result = spawnSync(
      "node",
      [cliPath, "--quiet", "ask", project, "qwertyuiop"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });
});
