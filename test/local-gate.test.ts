import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installGitHooks } from "../scripts/install-hooks.mjs";

const repoRoot = join(import.meta.dirname, "..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-gate-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Gate Test"], { cwd: dir });
  return dir;
}

function writeGatePackage(repo: string, exitCode: number): void {
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      name: "gate-fixture",
      private: true,
      scripts: { gate: `node -e "process.exit(${exitCode})"` },
    }),
    "utf8",
  );
}

function installCopiedHook(repo: string): void {
  const hooksDir = join(repo, ".githooks");
  mkdirSync(hooksDir);
  const hookPath = join(hooksDir, "pre-push");
  copyFileSync(join(repoRoot, ".githooks", "pre-push"), hookPath);
  chmodSync(hookPath, 0o755);
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: repo });
}

function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-m", message], { cwd: repo });
}

function push(repo: string, bare: string, extraArgs: string[] = []): void {
  execFileSync("git", ["push", ...extraArgs, bare, "HEAD:refs/heads/main"], {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function remoteHasMain(bare: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "refs/heads/main"], {
      cwd: bare,
      encoding: "utf8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

describe("local pre-push gate", () => {
  it("package scripts run the existing check and install hooks from prepare", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.check).toBe("tsc --noEmit && vitest run");
    expect(pkg.scripts.gate).toBe("node scripts/gate.mjs");
    expect(pkg.scripts["hooks:install"]).toBe("node scripts/install-hooks.mjs");
    expect(pkg.scripts.prepare).toContain("npm run build");
    expect(pkg.scripts.prepare).toContain("node scripts/install-hooks.mjs");
    expect(readFileSync(join(repoRoot, "scripts/gate.mjs"), "utf8")).toContain('"check"');
    const index = execFileSync("git", ["ls-files", "-s", ".githooks/pre-push"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(index.startsWith("100755")).toBe(true);
  });

  it("installs core.hooksPath only for a git checkout that has not chosen another path", () => {
    const repo = initRepo();
    expect(installGitHooks(repo)).toEqual({ status: "installed" });
    expect(git(repo, ["config", "--local", "--get", "core.hooksPath"]).trim()).toBe(".githooks");
    expect(installGitHooks(repo)).toEqual({ status: "unchanged" });

    const custom = initRepo();
    execFileSync("git", ["config", "core.hooksPath", "custom-hooks"], { cwd: custom });
    expect(installGitHooks(custom)).toEqual({
      status: "skipped",
      reason: "core.hooksPath is already custom-hooks",
    });
    expect(git(custom, ["config", "--local", "--get", "core.hooksPath"]).trim()).toBe(
      "custom-hooks",
    );

    const plain = mkdtempSync(join(tmpdir(), "gitbrain-gate-plain-"));
    expect(installGitHooks(plain)).toEqual({ status: "skipped", reason: "not a git checkout" });
  }, 20_000);

  it("pre-push blocks a failed gate and allows --no-verify", () => {
    const bare = mkdtempSync(join(tmpdir(), "gitbrain-gate-bare-"));
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);

    const repo = initRepo();
    writeGatePackage(repo, 1);
    installCopiedHook(repo);
    commitAll(repo, "failing gate");

    let rejected = false;
    try {
      push(repo, bare);
    } catch (error) {
      rejected = true;
      const err = error as { message?: string; stderr?: string; stdout?: string };
      const text = `${err.message ?? ""}\n${err.stderr ?? ""}\n${err.stdout ?? ""}`;
      expect(text).toMatch(/pre-push gate failed/);
    }
    expect(rejected).toBe(true);
    expect(remoteHasMain(bare)).toBe(false);

    push(repo, bare, ["--no-verify"]);
    expect(remoteHasMain(bare)).toBe(true);
  }, 20_000);

  it("pre-push allows the push when the gate exits 0", () => {
    const bare = mkdtempSync(join(tmpdir(), "gitbrain-gate-bare-ok-"));
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);

    const repo = initRepo();
    writeGatePackage(repo, 0);
    installCopiedHook(repo);
    commitAll(repo, "passing gate");

    push(repo, bare);
    expect(remoteHasMain(bare)).toBe(true);
  }, 20_000);
});
