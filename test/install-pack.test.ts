import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BRAIN_DIR } from "../src/brain.js";
import { VERSION } from "../src/version.js";
import { ensureDistBuilt } from "./ensure-dist.js";
import { execNpm } from "./helpers/npm-exec.js";
import { isWindows } from "./helpers/platform.js";

const repoRoot = join(import.meta.dirname, "..");

function npmPackTarball(destDir: string): string {
  const out = execNpm(["pack", "--pack-destination", destDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const line = out
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".tgz"))
    .pop();
  if (!line) {
    throw new Error(`npm pack did not print a .tgz name:\n${out}`);
  }
  return join(destDir, line);
}

function resolveGlobalBrainBin(npmPrefix: string): string {
  const candidates = [
    join(npmPrefix, "bin", "brain"),
    join(npmPrefix, "bin", "brain.cmd"),
    join(npmPrefix, "brain.cmd"),
    join(npmPrefix, "brain"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`brain executable not found under npm prefix ${npmPrefix}`);
}

function tmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-pack-repo-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

describe("global install from npm pack", () => {
  const workDir = mkdtempSync(join(tmpdir(), "gitbrain-pack-install-"));
  const npmPrefix = join(workDir, "npm-prefix");
  let brainBin: string;

  beforeAll(
    () => {
      ensureDistBuilt();
      const tarball = npmPackTarball(workDir);
      execNpm(["install", "-g", "--prefix", npmPrefix, tarball], {
        cwd: workDir,
        stdio: "pipe",
      });
      brainBin = resolveGlobalBrainBin(npmPrefix);
    },
    // npm pack + global install easily exceeds the 10s default on slow CI runners.
    120_000,
  );

  it("exposes --version matching package.json", () => {
    const version = execFileSync(brainBin, ["--version"], {
      encoding: "utf8",
      shell: isWindows,
    }).trim();
    expect(version).toBe(VERSION);
  });

  it("runs init and heal --dry-run on a fresh git repo", () => {
    const project = tmpGitRepo();
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: project });

    const initOut = execFileSync(brainBin, ["init", project], {
      encoding: "utf8",
      shell: isWindows,
    });
    expect(initOut).toContain("Created 5 memory files");
    expect(existsSync(join(project, BRAIN_DIR, "brain.json"))).toBe(true);

    const healOut = execFileSync(brainBin, ["heal", project, "--dry-run"], {
      encoding: "utf8",
      shell: isWindows,
    });
    expect(healOut).toContain("Dry run");
    expect(healOut).toMatch(/memory is up to date|Reconciling/);
  });
});
