import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWindows } from "./helpers/platform.js";

const root = new URL("..", import.meta.url);
const script = new URL("scripts/demo.sh", root);

describe("scripts/demo.sh committed artifacts", () => {
  it("committed heal-output.txt matches --refresh heal body", () => {
    const example = new URL("examples/demo-project/", root);
    const healOutput = readFileSync(new URL("heal-output.txt", example), "utf8");
    const transcript = readFileSync(new URL("demo-transcript.txt", example), "utf8");
    expect(healOutput).toContain("Wrote memory drift report");
    expect(transcript).toContain("dist/cli.js heal");
    expect(transcript).toContain(healOutput.trim());
  });
});

describe.skipIf(isWindows)("scripts/demo.sh (bash)", () => {
  it("runs the demo walkthrough against a temp repo", () => {
    expect(existsSync(script)).toBe(true);
    const out = execFileSync("bash", [script.pathname], {
      cwd: new URL(".", root).pathname,
      encoding: "utf8",
      env: { ...process.env, PATH: process.env.PATH },
    });
    expect(out).toContain('✓ O-0001  "Race in checkout queue"');
    expect(out).toContain("→ closed");
    expect(out).toContain("Wrote memory drift report");
  });

  it("--refresh rewrites committed demo artifacts with drift output", () => {
    const exampleDir = new URL("examples/demo-project/", root).pathname;
    const healPath = join(exampleDir, "heal-output.txt");

    execFileSync("bash", [script.pathname, "--refresh"], {
      cwd: new URL(".", root).pathname,
      encoding: "utf8",
    });

    const heal = readFileSync(healPath, "utf8");
    expect(heal).toContain('✓ O-0001  "Race in checkout queue"');
    expect(heal).toContain("Wrote memory drift report");
  });
});
