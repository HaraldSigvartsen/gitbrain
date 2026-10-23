import { relative } from "node:path";

/**
 * Repo-relative paths in markdown, drift reports, and git output always use
 * forward slashes so brains stay portable across macOS, Linux, and Windows.
 */
export function toPosixRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

/** Repo-relative path from an absolute path under `projectDir`. */
export function posixRelativePath(projectDir: string, absolutePath: string): string {
  return toPosixRepoPath(relative(projectDir, absolutePath));
}
