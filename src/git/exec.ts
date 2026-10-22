import { execFileSync } from "node:child_process";

const MAX_BUFFER = 16 * 1024 * 1024;

export class GitError extends Error {
  readonly repoDir: string;
  readonly stderr: string;

  constructor(message: string, repoDir: string, stderr: string) {
    super(message);
    this.name = "GitError";
    this.repoDir = repoDir;
    this.stderr = stderr;
  }
}

function stderrFromExecError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") {
      return stderr;
    }
    if (Buffer.isBuffer(stderr)) {
      return stderr.toString("utf8");
    }
  }
  return "";
}

/** Run `git` in `repoDir` with fixed arguments — no shell interpolation. */
export function git(repoDir: string, args: string[]): string {
  try {
    const stdout = execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return stdout.replace(/\r\n/g, "\n").replace(/\n$/, "");
  } catch (error) {
    const stderr = stderrFromExecError(error);
    if (/not a git repository/i.test(stderr) || /not a git repo/i.test(stderr)) {
      throw new GitError(`Not a git repository: ${repoDir}`, repoDir, stderr);
    }
    throw new GitError(
      stderr.trim() || `git ${args.join(" ")} failed in ${repoDir}`,
      repoDir,
      stderr,
    );
  }
}
