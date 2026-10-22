import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LedgerMismatch, ParsedBrain } from "../brain/parse.js";
import type { ChangeSet, FileChange } from "../git/diff.js";

/** Minimum combined line churn before a modify can count as a heavy rewrite. */
export const HEAVY_REWRITE_MIN_LINES = 10;

/**
 * When min(added, removed) / max(added, removed) is below this, the file was
 * largely replaced rather than edited in place.
 */
export const HEAVY_REWRITE_MAX_SIMILARITY = 0.35;

export type CloseReason = "path_deleted" | "path_heavily_rewritten";

export interface CloseCandidate {
  observationId: string;
  title: string;
  reason: CloseReason;
  paths: string[];
  detail: string;
}

export type SupersedeReason = "subject_deleted" | "subject_heavily_rewritten";

export interface SupersedeCandidate {
  decisionId: string;
  title: string;
  reason: SupersedeReason;
  paths: string[];
  detail: string;
}

export type StaleContextReason = "missing_at_head" | "deleted_in_range";

export interface StaleContextPath {
  path: string;
  reason: StaleContextReason;
  detail: string;
}

export interface ObservationRepointCandidate {
  observationId: string;
  title: string;
  fromPath: string;
  toPath: string;
  detail: string;
}

export interface ContextRepointCandidate {
  fromPath: string;
  toPath: string;
  detail: string;
}

export interface DriftReport {
  sinceSha: string;
  headSha: string;
  commitCount: number;
  capped: boolean;
  closeCandidates: CloseCandidate[];
  supersedeCandidates: SupersedeCandidate[];
  observationRepoints: ObservationRepointCandidate[];
  contextRepoints: ContextRepointCandidate[];
  staleContextPaths: StaleContextPath[];
  ledgerMismatches: LedgerMismatch[];
}

function changeByPath(files: FileChange[]): Map<string, FileChange> {
  const map = new Map<string, FileChange>();
  for (const file of files) {
    map.set(file.path, file);
    if (file.previousPath) {
      map.set(file.previousPath, file);
    }
  }
  return map;
}

function isHeavyRewrite(file: FileChange): boolean {
  if (file.status !== "modified") {
    return false;
  }
  const churn = file.added + file.removed;
  if (churn < HEAVY_REWRITE_MIN_LINES) {
    return false;
  }
  const max = Math.max(file.added, file.removed, 1);
  const min = Math.min(file.added, file.removed);
  if (min >= HEAVY_REWRITE_MIN_LINES) {
    return true;
  }
  return min / max < HEAVY_REWRITE_MAX_SIMILARITY;
}

function pathDeletedInRange(file: FileChange | undefined, path: string): boolean {
  if (!file) {
    return false;
  }
  if (file.status === "deleted" && file.path === path) {
    return true;
  }
  return false;
}

/** Do not treat rename sources as deleted or missing — they are re-pointed instead. */
export function pathRenamedInRange(file: FileChange | undefined, path: string): boolean {
  if (!file) {
    return false;
  }
  return file.status === "renamed" && file.previousPath === path;
}

export function buildRenameMap(files: FileChange[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    if (file.status === "renamed" && file.previousPath) {
      map.set(file.previousPath, file.path);
    }
  }
  return map;
}

/** Follow rename chains within the reconciled range (A→B→C). */
export function resolveRenameTarget(fromPath: string, renames: Map<string, string>): string | null {
  let current = fromPath;
  let next = renames.get(current);
  if (!next) {
    return null;
  }
  const visited = new Set<string>([fromPath]);
  while (next) {
    if (visited.has(next)) {
      break;
    }
    visited.add(next);
    current = next;
    next = renames.get(current);
  }
  return current === fromPath ? null : current;
}

function describeChange(file: FileChange, path: string): string {
  if (file.status === "deleted") {
    return `${path} was deleted in the reconciled range`;
  }
  if (file.status === "modified" && isHeavyRewrite(file)) {
    return `${path} was heavily rewritten (+${file.added}/-${file.removed} lines)`;
  }
  if (file.status === "renamed" && file.previousPath === path) {
    return `${path} was renamed to ${file.path}`;
  }
  return `${path} changed (${file.status})`;
}

function pathsWithDrift(
  paths: string[],
  changes: Map<string, FileChange>,
): { reason: CloseReason | SupersedeReason; paths: string[]; detail: string } | null {
  const hitPaths: string[] = [];
  let reason: CloseReason | SupersedeReason | null = null;
  const details: string[] = [];

  for (const path of paths) {
    const file = changes.get(path);
    if (pathRenamedInRange(file, path)) {
      continue;
    }
    if (pathDeletedInRange(file, path)) {
      hitPaths.push(path);
      reason = reason ?? "path_deleted";
      if (file) {
        details.push(describeChange(file, path));
      }
      continue;
    }
    if (file && isHeavyRewrite(file)) {
      hitPaths.push(path);
      reason = reason === "path_deleted" ? reason : "path_heavily_rewritten";
      details.push(describeChange(file, path));
    }
  }

  if (hitPaths.length === 0 || !reason) {
    return null;
  }

  const detail = details.join("; ");
  if (reason === "path_deleted") {
    return { reason, paths: hitPaths, detail };
  }
  return {
    reason: "path_heavily_rewritten" as SupersedeReason,
    paths: hitPaths,
    detail,
  };
}

function mapCloseReason(
  reason: CloseReason | SupersedeReason,
): CloseReason {
  return reason === "path_deleted" ? "path_deleted" : "path_heavily_rewritten";
}

function mapSupersedeReason(
  reason: CloseReason | SupersedeReason,
): SupersedeReason {
  return reason === "path_deleted" ? "subject_deleted" : "subject_heavily_rewritten";
}

/**
 * Pure drift detection: structured git changes + parsed `.brain/` → proposals only.
 */
export function detectDrift(
  projectDir: string,
  changeSet: ChangeSet,
  brain: ParsedBrain,
): DriftReport {
  const changes = changeByPath(changeSet.files);
  const renames = buildRenameMap(changeSet.files);
  const closeCandidates: CloseCandidate[] = [];
  const supersedeCandidates: SupersedeCandidate[] = [];
  const observationRepoints: ObservationRepointCandidate[] = [];
  const contextRepoints: ContextRepointCandidate[] = [];
  const staleContextPaths: StaleContextPath[] = [];

  for (const observation of brain.observations) {
    if (observation.status !== "open" || observation.where.length === 0) {
      continue;
    }
    for (const wherePath of observation.where) {
      const toPath = resolveRenameTarget(wherePath, renames);
      if (!toPath) {
        continue;
      }
      const detail = `${wherePath} was renamed to ${toPath}`;
      observationRepoints.push({
        observationId: observation.id,
        title: observation.title,
        fromPath: wherePath,
        toPath,
        detail,
      });
    }
    const drift = pathsWithDrift(observation.where, changes);
    if (!drift) {
      continue;
    }
    closeCandidates.push({
      observationId: observation.id,
      title: observation.title,
      reason: mapCloseReason(drift.reason),
      paths: drift.paths,
      detail: drift.detail,
    });
  }

  for (const decision of brain.decisions) {
    if (decision.status !== "active" || decision.subjectPaths.length === 0) {
      continue;
    }
    const drift = pathsWithDrift(decision.subjectPaths, changes);
    if (!drift) {
      continue;
    }
    supersedeCandidates.push({
      decisionId: decision.id,
      title: decision.title,
      reason: mapSupersedeReason(drift.reason),
      paths: drift.paths,
      detail: drift.detail,
    });
  }

  const seenStale = new Set<string>();
  const seenContextRepoint = new Set<string>();
  for (const contextPath of brain.contextPaths) {
    if (seenStale.has(contextPath)) {
      continue;
    }
    const file = changes.get(contextPath);
    const renamedTo = resolveRenameTarget(contextPath, renames);
    if (renamedTo && !seenContextRepoint.has(contextPath)) {
      seenContextRepoint.add(contextPath);
      contextRepoints.push({
        fromPath: contextPath,
        toPath: renamedTo,
        detail: file ? describeChange(file, contextPath) : `${contextPath} was renamed to ${renamedTo}`,
      });
      continue;
    }
    if (pathDeletedInRange(file, contextPath)) {
      seenStale.add(contextPath);
      staleContextPaths.push({
        path: contextPath,
        reason: "deleted_in_range",
        detail: file ? describeChange(file, contextPath) : `${contextPath} was deleted`,
      });
      continue;
    }
    const abs = join(projectDir, contextPath);
    if (!existsSync(abs)) {
      seenStale.add(contextPath);
      staleContextPaths.push({
        path: contextPath,
        reason: "missing_at_head",
        detail: `${contextPath} is not present at HEAD`,
      });
    }
  }

  staleContextPaths.sort((a, b) => a.path.localeCompare(b.path));
  closeCandidates.sort((a, b) => a.observationId.localeCompare(b.observationId));
  supersedeCandidates.sort((a, b) => a.decisionId.localeCompare(b.decisionId));
  observationRepoints.sort((a, b) =>
    a.observationId.localeCompare(b.observationId) || a.fromPath.localeCompare(b.fromPath),
  );
  contextRepoints.sort((a, b) => a.fromPath.localeCompare(b.fromPath));

  return {
    sinceSha: changeSet.sinceSha,
    headSha: changeSet.headSha,
    commitCount: changeSet.commits.length,
    capped: changeSet.capped,
    closeCandidates,
    supersedeCandidates,
    observationRepoints,
    contextRepoints,
    staleContextPaths,
    ledgerMismatches: brain.ledgerMismatches,
  };
}

export function isHeavyRewriteChange(file: FileChange): boolean {
  return isHeavyRewrite(file);
}
