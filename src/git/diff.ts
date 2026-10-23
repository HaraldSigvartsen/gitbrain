import { git, GitError } from "./exec.js";

/** Git's canonical empty tree object id — valid parent for the first commit's diff. */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** On the first heal (no `last_reconciled_sha`), only this many commits are scanned. */
export const FIRST_RUN_COMMIT_CAP = 500;

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface CommitInfo {
  sha: string;
  subject: string;
}

export interface FileChange {
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  previousPath?: string;
}

export interface ChangeSet {
  /** SHA diffed from (exclusive); empty tree on a full first run. */
  sinceSha: string;
  headSha: string;
  commits: CommitInfo[];
  files: FileChange[];
  /** Every path touched in the range (current paths plus rename sources). */
  touchedPaths: string[];
  /** True when first-run history was truncated to `FIRST_RUN_COMMIT_CAP`. */
  capped: boolean;
}

export interface CollectChangeSetOptions {
  /**
   * Optional lower bound: commit SHA, ref (e.g. `HEAD~100`), or ISO date for
   * `git rev-list --since`. Never reconciles older than `last_reconciled_sha`.
   */
  since?: string;
}

function parseNumstat(stdout: string): {
  counts: Map<string, { added: number; removed: number }>;
  renames: Map<string, { added: number; removed: number }>;
} {
  const counts = new Map<string, { added: number; removed: number }>();
  const renames = new Map<string, { added: number; removed: number }>();
  if (!stdout) {
    return { counts, renames };
  }
  const toCount = (raw: string): number => {
    if (raw === "-") {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  // With -z, a rename record is `added\tremoved\t` + NUL + old path + NUL + new
  // path + NUL; every other record is `added\tremoved\tpath` + NUL.
  const tokens = stdout.split("\0");
  const record = /^(-|\d+)\t(-|\d+)\t?([\s\S]*)$/;
  for (let i = 0; i < tokens.length;) {
    const match = record.exec(tokens[i] ?? "");
    if (!match) {
      i += 1;
      continue;
    }
    const line = { added: toCount(match[1]!), removed: toCount(match[2]!) };
    if (match[3] !== "") {
      counts.set(match[3], line);
      i += 1;
    } else {
      const previousPath = tokens[i + 1];
      const path = tokens[i + 2];
      if (previousPath !== undefined && path !== undefined) {
        renames.set(path, line);
      }
      i += 3;
    }
  }
  return { counts, renames };
}

interface NameStatusRow {
  status: FileStatus;
  path: string;
  previousPath?: string;
}

function parseNameStatus(stdout: string): NameStatusRow[] {
  const rows: NameStatusRow[] = [];
  if (!stdout.trim()) {
    return rows;
  }
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    if (code.startsWith("A")) {
      rows.push({ status: "added", path: parts[1] ?? "" });
    } else if (code.startsWith("M")) {
      rows.push({ status: "modified", path: parts[1] ?? "" });
    } else if (code.startsWith("D")) {
      rows.push({ status: "deleted", path: parts[1] ?? "" });
    } else if (code.startsWith("R")) {
      const previousPath = parts[1] ?? "";
      const path = parts[2] ?? "";
      rows.push({ status: "renamed", path, previousPath });
    }
  }
  return rows;
}

function listCommits(repoDir: string, range: string): CommitInfo[] {
  const stdout = git(repoDir, ["log", `--format=%H%x1f%s`, "--reverse", range]);
  if (!stdout) {
    return [];
  }
  return stdout.split("\n").map((line) => {
    const [sha, subject = ""] = line.split("\x1f");
    return { sha, subject };
  });
}

/** Pick the oldest SHA to diff from when scanning a capped first-run window. */
export function oldestShaInCappedWindow(
  allShasOldestFirst: string[],
  cap: number,
): { window: string[]; capped: boolean } {
  if (allShasOldestFirst.length <= cap) {
    return { window: allShasOldestFirst, capped: false };
  }
  return { window: allShasOldestFirst.slice(-cap), capped: true };
}

function assertRecordedSha(repoDir: string, sha: string, label: string): void {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new GitError(
      `${label} "${sha}" is not a hexadecimal SHA — refusing to pass it to git.`,
      repoDir,
      "",
    );
  }
  try {
    git(repoDir, ["rev-parse", "--verify", `${sha}^{commit}`]);
  } catch {
    throw new GitError(
      `${label} ${sha} is not a commit in this repository — ` +
        `was history rewritten? Clear last_reconciled_sha in brain.json to reconcile from scratch.`,
      repoDir,
      "",
    );
  }
}

function isAncestor(repoDir: string, ancestor: string, descendant: string): boolean {
  try {
    git(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/** Return the later of two commits on the same branch (closer to HEAD). */
export function laterCommit(repoDir: string, a: string, b: string): string {
  if (a === b) {
    return a;
  }
  if (isAncestor(repoDir, a, b)) {
    return b;
  }
  if (isAncestor(repoDir, b, a)) {
    return a;
  }
  throw new GitError(
    `Cannot reconcile --since: ${a.slice(0, 7)} and ${b.slice(0, 7)} are not on the same ancestry line.`,
    repoDir,
    "",
  );
}

function parentShaOrEmptyTree(repoDir: string, commitSha: string): string {
  try {
    return git(repoDir, ["rev-parse", `${commitSha}^`]);
  } catch {
    return EMPTY_TREE_SHA;
  }
}

function commitCountInRange(repoDir: string, range: string): number {
  const raw = git(repoDir, ["rev-list", "--count", range]);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Oldest commit among the `cap` newest commits in `range` (default: entire history). */
function oldestAmongNewestInRange(repoDir: string, range: string, cap: number): string {
  const stdout = git(repoDir, ["rev-list", "-n", String(cap), range]);
  const lines = stdout.split("\n").filter(Boolean);
  const oldest = lines.at(-1);
  if (!oldest) {
    throw new GitError(`Could not resolve a capped history window for ${range}.`, repoDir, "");
  }
  return oldest;
}

function capRangeFromHead(repoDir: string, cap: number): { sinceSha: string; capped: boolean } {
  const total = commitCountInRange(repoDir, "HEAD");
  if (total <= cap) {
    return { sinceSha: EMPTY_TREE_SHA, capped: false };
  }
  const oldestInWindow = oldestAmongNewestInRange(repoDir, "HEAD", cap);
  return { sinceSha: parentShaOrEmptyTree(repoDir, oldestInWindow), capped: true };
}

/**
 * Resolve `brain heal --since` to the exclusive lower bound for `since..HEAD`.
 * Accepts a commit-ish or an ISO date string for `git rev-list --since`.
 */
export function resolveSinceOption(repoDir: string, spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new GitError("--since requires a commit ref or date.", repoDir, "");
  }
  try {
    git(repoDir, ["rev-parse", "--verify", `${trimmed}^{commit}`]);
    return git(repoDir, ["rev-parse", trimmed]);
  } catch {
    const oldestAfterDate = git(repoDir, [
      "rev-list",
      "-n",
      "1",
      "--reverse",
      `--since=${trimmed}`,
      "HEAD",
    ]);
    if (!oldestAfterDate) {
      throw new GitError(`No commits found on or after --since ${trimmed}.`, repoDir, "");
    }
    return parentShaOrEmptyTree(repoDir, oldestAfterDate);
  }
}

function capFloorWithinRange(
  repoDir: string,
  floorSha: string,
  cap: number,
): { sinceSha: string; capped: boolean } {
  const range = `${floorSha}..HEAD`;
  const count = commitCountInRange(repoDir, range);
  if (count <= cap) {
    return { sinceSha: floorSha, capped: false };
  }
  const oldestInWindow = oldestAmongNewestInRange(repoDir, range, cap);
  return { sinceSha: parentShaOrEmptyTree(repoDir, oldestInWindow), capped: true };
}

function resolveSinceBoundary(
  repoDir: string,
  lastReconciledSha: string | null,
  options?: CollectChangeSetOptions,
): { sinceSha: string; capped: boolean } {
  let explicitFloor: string | null = null;
  if (options?.since) {
    explicitFloor = resolveSinceOption(repoDir, options.since);
  }

  if (lastReconciledSha) {
    assertRecordedSha(repoDir, lastReconciledSha, "Recorded last_reconciled_sha");
    let sinceSha = lastReconciledSha;
    if (explicitFloor) {
      sinceSha = laterCommit(repoDir, explicitFloor, sinceSha);
    }
    return { sinceSha, capped: false };
  }

  if (explicitFloor) {
    return capFloorWithinRange(repoDir, explicitFloor, FIRST_RUN_COMMIT_CAP);
  }

  return capRangeFromHead(repoDir, FIRST_RUN_COMMIT_CAP);
}

/**
 * Aggregate `git diff since..head` omits paths that were added and removed within the
 * range (net absent at HEAD). `git log --name-status` still records those deletes.
 */
function mergeEphemeralDeletesFromLog(
  repoDir: string,
  range: string,
  files: FileChange[],
): FileChange[] {
  const logRows = parseNameStatus(
    git(repoDir, ["log", "--name-status", "-M", "--find-renames", "--pretty=format:", range]),
  );
  const pathsInFiles = new Set(files.map((f) => f.path));
  const extra: FileChange[] = [];
  for (const row of logRows) {
    if (row.status !== "deleted" || pathsInFiles.has(row.path)) {
      continue;
    }
    pathsInFiles.add(row.path);
    extra.push({
      path: row.path,
      status: "deleted",
      added: 0,
      removed: 0,
    });
  }
  return extra.length > 0 ? [...files, ...extra] : files;
}

/**
 * Collect a structured change set from git history after `lastReconciledSha`
 * (or from the first commit on first run, capped).
 */
export function collectChangeSet(
  repoDir: string,
  lastReconciledSha: string | null,
  options?: CollectChangeSetOptions,
): ChangeSet {
  const headSha = git(repoDir, ["rev-parse", "HEAD"]);
  const { sinceSha, capped } = resolveSinceBoundary(repoDir, lastReconciledSha, options);
  const range = `${sinceSha}..${headSha}`;

  const commits = listCommits(repoDir, range);

  const nameStatus = parseNameStatus(
    git(repoDir, ["diff", "--name-status", "-M", "--find-renames", range]),
  );
  // -z is required: plain numstat brace-compresses same-directory renames
  // (`src/{old.ts => new.ts}`), which loses the real per-path line counts.
  const numstat = parseNumstat(
    git(repoDir, ["diff", "--numstat", "-M", "--find-renames", "-z", range]),
  );

  let files: FileChange[] = nameStatus.map((row) => {
    const stat = (row.status === "renamed" ? numstat.renames.get(row.path) : undefined) ??
      numstat.counts.get(row.path) ?? { added: 0, removed: 0 };
    const file: FileChange = {
      path: row.path,
      status: row.status,
      added: stat.added,
      removed: stat.removed,
    };
    if (row.previousPath) {
      file.previousPath = row.previousPath;
    }
    return file;
  });

  files = mergeEphemeralDeletesFromLog(repoDir, range, files);

  const touched = new Set<string>();
  for (const file of files) {
    if (file.path) {
      touched.add(file.path);
    }
    if (file.previousPath) {
      touched.add(file.previousPath);
    }
  }

  return {
    sinceSha,
    headSha,
    commits,
    files,
    touchedPaths: [...touched].sort(),
    capped,
  };
}
