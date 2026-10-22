import { git } from "./exec.js";

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

function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const stats = new Map<string, { added: number; removed: number }>();
  if (!stdout.trim()) {
    return stats;
  }
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const addedRaw = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const tab2 = rest.indexOf("\t");
    if (tab2 === -1) {
      continue;
    }
    const removedRaw = rest.slice(0, tab2);
    const path = rest.slice(tab2 + 1);
    const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
    const removed = removedRaw === "-" ? 0 : Number.parseInt(removedRaw, 10);
    stats.set(path, {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
    });
  }
  return stats;
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

function resolveSinceBoundary(
  repoDir: string,
  lastReconciledSha: string | null,
): { sinceSha: string; capped: boolean } {
  if (lastReconciledSha) {
    git(repoDir, ["rev-parse", "--verify", `${lastReconciledSha}^{commit}`]);
    return { sinceSha: lastReconciledSha, capped: false };
  }

  const allShas = git(repoDir, ["rev-list", "--reverse", "HEAD"]).split("\n").filter(Boolean);
  const { window, capped } = oldestShaInCappedWindow(allShas, FIRST_RUN_COMMIT_CAP);
  if (!capped) {
    return { sinceSha: EMPTY_TREE_SHA, capped: false };
  }

  const oldest = window[0];
  if (!oldest) {
    return { sinceSha: EMPTY_TREE_SHA, capped: true };
  }
  try {
    const parent = git(repoDir, ["rev-parse", `${oldest}^`]);
    return { sinceSha: parent, capped: true };
  } catch {
    return { sinceSha: EMPTY_TREE_SHA, capped: true };
  }
}

/**
 * Collect a structured change set from git history after `lastReconciledSha`
 * (or from the first commit on first run, capped).
 */
export function collectChangeSet(
  repoDir: string,
  lastReconciledSha: string | null,
): ChangeSet {
  const headSha = git(repoDir, ["rev-parse", "HEAD"]);
  const { sinceSha, capped } = resolveSinceBoundary(repoDir, lastReconciledSha);
  const range = `${sinceSha}..${headSha}`;

  const commits = listCommits(repoDir, range);

  const nameStatus = parseNameStatus(
    git(repoDir, ["diff", "--name-status", "-M", "--find-renames", range]),
  );
  const numstat = parseNumstat(
    git(repoDir, ["diff", "--numstat", "-M", "--find-renames", range]),
  );

  const files: FileChange[] = nameStatus.map((row) => {
    const statKey =
      row.status === "renamed" && row.previousPath
        ? `${row.previousPath} => ${row.path}`
        : row.path;
    const stat = numstat.get(statKey) ?? numstat.get(row.path) ?? { added: 0, removed: 0 };
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
