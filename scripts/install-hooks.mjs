import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOKS_PATH = ".githooks";

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

/**
 * Point this clone's local git config at `.githooks` so `pre-push` runs the gate.
 * Does nothing when this directory is not a checkout, git is missing, or
 * `core.hooksPath` is already set to a different path.
 *
 * @param {string} root repository root
 * @returns {{ status: "installed" | "unchanged" | "skipped", reason?: string }}
 */
export function installGitHooks(root) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error && (inside.error.code === "ENOENT" || inside.error.code === "ENOTDIR")) {
    return { status: "skipped", reason: "git is not on PATH" };
  }
  if (inside.status !== 0 || (inside.stdout ?? "").trim() !== "true") {
    return { status: "skipped", reason: "not a git checkout" };
  }

  const current = git(root, ["config", "--local", "--get", "core.hooksPath"]);
  const value = (current.stdout ?? "").trim();
  if (current.status === 0 && value === HOOKS_PATH) {
    return { status: "unchanged" };
  }
  if (current.status === 0 && value && value !== HOOKS_PATH) {
    return {
      status: "skipped",
      reason: `core.hooksPath is already ${value}`,
    };
  }

  const set = git(root, ["config", "--local", "core.hooksPath", HOOKS_PATH]);
  if (set.status !== 0) {
    const detail = (set.stderr || set.stdout || "git config failed").trim();
    throw new Error(`gitbrain: could not set core.hooksPath: ${detail}`);
  }
  return { status: "installed" };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isDirectRun()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = installGitHooks(root);
    if (result.status === "installed" || result.status === "unchanged") {
      console.log(
        "gitbrain: pre-push hook enabled (git config core.hooksPath .githooks). It runs npm run gate.",
      );
    } else {
      console.log(
        `gitbrain: hooks not changed (${result.reason}). Run npm run gate before you push.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
