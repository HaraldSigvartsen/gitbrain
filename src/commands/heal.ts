import { relative } from "node:path";
import { type CliTheme, createTheme } from "../cli/theme.js";
import { parseBrain } from "../brain/parse.js";
import { commitBrainMemory, type CommitBrainResult } from "../git/commit-brain.js";
import { collectChangeSet, EMPTY_TREE_SHA } from "../git/diff.js";
import { applyDriftReport, type ApplyChange, type ApplyResult } from "../heal/apply.js";
import { detectDrift, type DriftReport, type StaleContextPath } from "../heal/detect.js";
import { readLedger } from "./status.js";

export interface HealOptions {
  dryRun?: boolean;
  commit?: boolean;
  /** Commit ref or ISO date — see `collectChangeSet` / `brain heal --since`. */
  since?: string;
  now?: Date;
}

export interface HealResult {
  projectDir: string;
  dryRun: boolean;
  report: DriftReport;
  apply: ApplyResult;
  commit: CommitBrainResult | null;
}

export function runHeal(projectDir: string, options: HealOptions = {}): HealResult {
  const dryRun = options.dryRun ?? false;
  const wantCommit = options.commit ?? false;
  if (wantCommit && dryRun) {
    throw new Error("--commit cannot be used with --dry-run");
  }
  const ledger = readLedger(projectDir);
  const changeSet = collectChangeSet(projectDir, ledger.last_reconciled_sha, {
    since: options.since,
  });
  const brain = parseBrain(projectDir);
  const report = detectDrift(projectDir, changeSet, brain);
  const apply = applyDriftReport(projectDir, report, { dryRun, now: options.now });
  const commit = wantCommit ? commitBrainMemory(projectDir, apply) : null;
  return { projectDir, dryRun, report, apply, commit };
}

function formatSinceLabel(report: DriftReport, previousReconciledSha: string | null): string {
  if (previousReconciledSha) {
    return previousReconciledSha.slice(0, 7);
  }
  if (report.sinceSha === EMPTY_TREE_SHA) {
    return report.capped ? "capped history" : "repo start";
  }
  return report.sinceSha.slice(0, 7);
}

function padTitle(id: string, title: string, targetWidth: number, theme: CliTheme): string {
  const quoted = `"${title}"`;
  const plainPrefix = `  ✓ ${id}  ${quoted}`;
  const padding = Math.max(1, targetWidth - plainPrefix.length);
  const check = theme.success("✓");
  return `  ${check} ${id}  ${quoted}` + " ".repeat(padding);
}

const ACTION_COLUMN_WIDTH = 52;

function formatChangeLine(change: ApplyChange, theme: CliTheme): string[] {
  const action =
    change.kind === "observation_closed"
      ? "→ closed"
      : change.kind === "decision_superseded"
        ? "→ superseded"
        : change.kind === "observation_repointed"
          ? "→ re-pointed"
          : "→ re-pointed";
  const head = padTitle(change.id, change.title, ACTION_COLUMN_WIDTH, theme) + theme.dim(action);
  return [head, theme.dim(`            ${change.detail}`)];
}

function formatStaleLine(stale: StaleContextPath, theme: CliTheme): string[] {
  const warn = theme.warning("⚠");
  const head =
    `  ${warn} CONTEXT.md  \`${stale.path}\`` +
    " ".repeat(Math.max(1, ACTION_COLUMN_WIDTH - 20 - stale.path.length)) +
    theme.dim("→ stale");
  return [head, theme.dim(`            ${stale.detail}`)];
}

function formatMismatchLine(message: string, theme: CliTheme): string[] {
  const warn = theme.warning("⚠");
  return [`  ${warn} ledger`, theme.dim(`            ${message}`)];
}

/**
 * Human-readable heal output (README-style). Printing is done in `src/cli.ts`.
 */
export function formatHealHumanOutput(result: HealResult, theme: CliTheme = createTheme(false)): string {
  const { report, apply } = result;
  const since = formatSinceLabel(report, apply.previousReconciledSha);
  const commitWord = report.commitCount === 1 ? "commit" : "commits";
  const lines: string[] = [
    theme.dim(
      `Reconciling .brain against git since ${since} (${report.commitCount} ${commitWord})…`,
    ),
    "",
  ];

  const body: string[] = [];
  for (const change of apply.changes) {
    body.push(...formatChangeLine(change, theme));
  }
  for (const stale of report.staleContextPaths) {
    body.push(...formatStaleLine(stale, theme));
  }
  for (const mismatch of report.ledgerMismatches) {
    body.push(...formatMismatchLine(mismatch.message, theme));
  }

  if (body.length === 0) {
    lines.push(theme.dim("  (memory is up to date)"), "");
  } else {
    lines.push(...body, "");
  }

  if (result.dryRun) {
    if (apply.changes.length > 0 || apply.advancedReconciledSha) {
      lines.push(theme.dim("Dry run — no files written."), "");
    }
  } else if (apply.reportPath) {
    const rel = relative(result.projectDir, apply.reportPath);
    lines.push(theme.dim(`Wrote memory drift report → ${rel}`), "");
  }

  if (result.commit?.committed && result.commit.commitSha) {
    const short = result.commit.commitSha.slice(0, 7);
    lines.push(theme.dim(`Committed heal changes → ${short} (${result.commit.message})`), "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export interface HealJsonPayload {
  dryRun: boolean;
  sinceSha: string;
  headSha: string;
  commitCount: number;
  capped: boolean;
  previousReconciledSha: string | null;
  advancedReconciledSha: boolean;
  reportPath: string | null;
  changes: ApplyChange[];
  staleContextPaths: StaleContextPath[];
  ledgerMismatches: Array<{ message: string }>;
  commit: CommitBrainResult | null;
}

export function healResultToJson(result: HealResult): HealJsonPayload {
  const { report, apply } = result;
  return {
    dryRun: result.dryRun,
    sinceSha: report.sinceSha,
    headSha: report.headSha,
    commitCount: report.commitCount,
    capped: report.capped,
    previousReconciledSha: apply.previousReconciledSha,
    advancedReconciledSha: apply.advancedReconciledSha,
    reportPath: apply.reportPath,
    changes: apply.changes,
    staleContextPaths: report.staleContextPaths,
    ledgerMismatches: report.ledgerMismatches.map((m) => ({ message: m.message })),
    commit: result.commit,
  };
}
