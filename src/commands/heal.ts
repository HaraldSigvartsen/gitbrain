import { relative } from "node:path";
import { parseBrain } from "../brain/parse.js";
import { collectChangeSet, EMPTY_TREE_SHA } from "../git/diff.js";
import { applyDriftReport, type ApplyChange, type ApplyResult } from "../heal/apply.js";
import { detectDrift, type DriftReport, type StaleContextPath } from "../heal/detect.js";
import { readLedger } from "./status.js";

export interface HealOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface HealResult {
  projectDir: string;
  dryRun: boolean;
  report: DriftReport;
  apply: ApplyResult;
}

export function runHeal(projectDir: string, options: HealOptions = {}): HealResult {
  const dryRun = options.dryRun ?? false;
  const ledger = readLedger(projectDir);
  const changeSet = collectChangeSet(projectDir, ledger.last_reconciled_sha);
  const brain = parseBrain(projectDir);
  const report = detectDrift(projectDir, changeSet, brain);
  const apply = applyDriftReport(projectDir, report, { dryRun, now: options.now });
  return { projectDir, dryRun, report, apply };
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

function padTitle(id: string, title: string, targetWidth: number): string {
  const quoted = `"${title}"`;
  const prefix = `  ✓ ${id}  ${quoted}`;
  const padding = Math.max(1, targetWidth - prefix.length);
  return prefix + " ".repeat(padding);
}

const ACTION_COLUMN_WIDTH = 52;

function formatChangeLine(change: ApplyChange): string[] {
  const action =
    change.kind === "observation_closed"
      ? "→ closed"
      : "→ superseded";
  const head = padTitle(change.id, change.title, ACTION_COLUMN_WIDTH) + action;
  return [head, `            ${change.detail}`];
}

function formatStaleLine(stale: StaleContextPath): string[] {
  const head =
    `  ⚠ CONTEXT.md  \`${stale.path}\`` +
    " ".repeat(Math.max(1, ACTION_COLUMN_WIDTH - 20 - stale.path.length)) +
    "→ stale";
  return [head, `            ${stale.detail}`];
}

function formatMismatchLine(message: string): string[] {
  return [`  ⚠ ledger`, `            ${message}`];
}

/**
 * Human-readable heal output (README-style). Printing is done in `src/cli.ts`.
 */
export function formatHealHumanOutput(result: HealResult): string {
  const { report, apply } = result;
  const since = formatSinceLabel(report, apply.previousReconciledSha);
  const commitWord = report.commitCount === 1 ? "commit" : "commits";
  const lines: string[] = [
    `Reconciling .brain against git since ${since} (${report.commitCount} ${commitWord})…`,
    "",
  ];

  const body: string[] = [];
  for (const change of apply.changes) {
    body.push(...formatChangeLine(change));
  }
  for (const stale of report.staleContextPaths) {
    body.push(...formatStaleLine(stale));
  }
  for (const mismatch of report.ledgerMismatches) {
    body.push(...formatMismatchLine(mismatch.message));
  }

  if (body.length === 0) {
    lines.push("  (memory is up to date)", "");
  } else {
    lines.push(...body, "");
  }

  if (result.dryRun) {
    if (apply.changes.length > 0 || apply.advancedReconciledSha) {
      lines.push("Dry run — no files written.", "");
    }
  } else if (apply.reportPath) {
    const rel = relative(result.projectDir, apply.reportPath);
    lines.push(`Wrote memory drift report → ${rel}`, "");
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
  };
}
