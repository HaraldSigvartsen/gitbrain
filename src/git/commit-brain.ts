import { relative } from "node:path";
import {
  BRAIN_DIR,
  CONTEXT_FILE,
  DECISIONS_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
} from "../brain.js";
import type { ApplyResult } from "../heal/apply.js";
import { git } from "./exec.js";

export interface CommitBrainResult {
  committed: boolean;
  commitSha: string | null;
  message: string | null;
  paths: string[];
}

function posixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Paths under `.brain/` that heal wrote on this run (repo-relative, posix). */
export function brainPathsWrittenByHeal(projectDir: string, apply: ApplyResult): string[] {
  const paths: string[] = [];
  if (apply.wroteDecisions) {
    paths.push(`${BRAIN_DIR}/${DECISIONS_FILE}`);
  }
  if (apply.wroteObservations) {
    paths.push(`${BRAIN_DIR}/${OBSERVATIONS_FILE}`);
  }
  if (apply.wroteContext) {
    paths.push(`${BRAIN_DIR}/${CONTEXT_FILE}`);
  }
  if (apply.wroteLedger) {
    paths.push(`${BRAIN_DIR}/${LEDGER_FILE}`);
  }
  if (apply.reportPath) {
    paths.push(posixPath(relative(projectDir, apply.reportPath)));
  }
  return paths;
}

function assertUnderBrain(repoRelativePath: string): void {
  const normalised = posixPath(repoRelativePath);
  if (normalised === BRAIN_DIR || normalised.startsWith(`${BRAIN_DIR}/`)) {
    return;
  }
  throw new Error(`Refusing to stage path outside .brain/: ${repoRelativePath}`);
}

function listStagedPaths(projectDir: string): string[] {
  const out = git(projectDir, ["diff", "--cached", "--name-only"]);
  if (!out) {
    return [];
  }
  return out.split("\n").filter(Boolean).map(posixPath);
}

function formatCommitMessage(apply: ApplyResult): string {
  const parts: string[] = [];
  for (const change of apply.changes) {
    if (change.kind === "observation_closed") {
      parts.push("close obs");
    } else if (change.kind === "decision_superseded") {
      parts.push("supersede decision");
    } else if (change.kind === "observation_repointed" || change.kind === "context_repointed") {
      parts.push("re-point");
    }
  }
  if (apply.advancedReconciledSha && parts.length === 0) {
    return "chore(brain): advance reconciled SHA after heal";
  }
  const summary = parts.length ? ` (${parts.length} change${parts.length === 1 ? "" : "s"})` : "";
  return `chore(brain): heal memory drift${summary}`;
}

/**
 * Stage only files heal wrote and create a local commit. Never pushes.
 * Fails if non-`.brain/` paths are already staged.
 */
export function commitBrainMemory(projectDir: string, apply: ApplyResult): CommitBrainResult {
  const paths = brainPathsWrittenByHeal(projectDir, apply);
  if (paths.length === 0) {
    return { committed: false, commitSha: null, message: null, paths: [] };
  }

  for (const path of paths) {
    assertUnderBrain(path);
  }

  const alreadyStaged = listStagedPaths(projectDir);
  const foreign = alreadyStaged.filter((p) => !p.startsWith(`${BRAIN_DIR}/`) && p !== BRAIN_DIR);
  if (foreign.length > 0) {
    throw new Error(
      `Cannot commit heal changes: ${foreign[0]} is already staged. Unstage non-.brain/ files first.`,
    );
  }

  for (const path of paths) {
    git(projectDir, ["add", "--", path]);
  }

  const stagedNow = listStagedPaths(projectDir);
  for (const path of stagedNow) {
    assertUnderBrain(path);
  }

  const message = formatCommitMessage(apply);
  git(projectDir, ["commit", "-m", message]);

  const commitSha = git(projectDir, ["rev-parse", "HEAD"]);
  return { committed: true, commitSha, message, paths };
}
