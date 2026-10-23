import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHeal } from "../src/commands/heal.js";
import { isWindows } from "./helpers/platform.js";

const root = new URL("..", import.meta.url);
const exampleRoot = new URL("examples/demo-project/", root);

describe("demo-project example", () => {
  it("documents before/after heal snapshots", () => {
    const beforeObs = readFileSync(
      new URL("snapshots/before-heal/.brain/OBSERVATIONS.md", exampleRoot),
      "utf8",
    );
    const afterObs = readFileSync(
      new URL("snapshots/after-heal/.brain/OBSERVATIONS.md", exampleRoot),
      "utf8",
    );
    expect(beforeObs).toContain("**Status:** open");
    expect(beforeObs).toContain("`src/checkout/queue.ts`");
    expect(afterObs).toContain("**Status:** fixed");
    expect(afterObs).toMatch(/healed 2026-10-22/);
    expect(
      existsSync(new URL("snapshots/after-heal/.brain/reports/2026-10-22.md", exampleRoot)),
    ).toBe(true);
  });

  it("ships heal terminal output matching the README example shape", () => {
    const out = readFileSync(new URL("heal-output.txt", exampleRoot), "utf8");
    expect(out).toContain('✓ O-0001  "Race in checkout queue"');
    expect(out).toContain("→ closed");
    expect(out).toContain("Wrote memory drift report");
  });

  it.skipIf(isWindows)("build-history.sh reproduces drift that heal repairs", () => {
    const script = new URL("build-history.sh", exampleRoot);
    const cli = new URL("dist/cli.js", root);
    expect(existsSync(script)).toBe(true);
    expect(existsSync(cli)).toBe(true);

    const repo = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
    execFileSync("bash", [script.pathname, repo], { encoding: "utf8" });

    const beforeObs = readFileSync(join(repo, ".brain/OBSERVATIONS.md"), "utf8");
    expect(beforeObs).toContain("**Status:** open");

    runHeal(repo, { now: new Date("2026-10-22T12:00:00.000Z") });

    const afterSnapshot = readFileSync(
      new URL("snapshots/after-heal/.brain/OBSERVATIONS.md", exampleRoot),
      "utf8",
    );
    const afterObs = readFileSync(join(repo, ".brain/OBSERVATIONS.md"), "utf8");
    expect(afterObs).toBe(afterSnapshot);
  });
});
