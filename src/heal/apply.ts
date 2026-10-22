import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTEXT_FILE,
  DECISIONS_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
  brainDir,
  type Ledger,
  type LedgerEntry,
} from "../brain.js";
import { readLedger } from "../commands/status.js";
import type { DriftReport } from "./detect.js";

export interface ApplyChange {
  kind:
    | "observation_closed"
    | "decision_superseded"
    | "observation_repointed"
    | "context_repointed";
  id: string;
  title: string;
  detail: string;
}

export interface ApplyResult {
  dryRun: boolean;
  headSha: string;
  previousReconciledSha: string | null;
  advancedReconciledSha: boolean;
  reportPath: string | null;
  changes: ApplyChange[];
  wroteDecisions: boolean;
  wroteObservations: boolean;
  wroteContext: boolean;
  wroteLedger: boolean;
}

const ENTRY_HEADING = /^## ((?:D|O)-\d{4}) — /;

interface ObservationRepointBatch {
  title: string;
  details: Array<{ fromPath: string; toPath: string; detail: string }>;
}

function healAnnotationLine(date: string, detail: string): string {
  return `> healed ${date} — ${detail}`;
}

function entryHasHealAnnotation(lines: string[], detail: string): boolean {
  return lines.some((line) => line.startsWith("> healed ") && line.includes(detail));
}

function setStatusInLines(lines: string[], status: string): string[] {
  let updated = false;
  return lines.map((line) => {
    const match = /^\s*-\s*\*\*Status:\*\*\s*(.+)$/u.exec(line);
    if (!match || updated) {
      return line;
    }
    const current = match[1].replace(/\s*<!--[\s\S]*?-->/g, "").trim();
    if (current === status) {
      return line;
    }
    updated = true;
    const comment = /<!--[\s\S]*?-->/.exec(match[1]);
    const suffix = comment ? ` ${comment[0]}` : "";
    return `- **Status:** ${status}${suffix}`;
  });
}

function repointWhereInLines(lines: string[], fromPath: string, toPath: string): string[] {
  return lines.map((line) => {
    const match = /^\s*-\s*\*\*Where:\*\*\s*(.+)$/u.exec(line);
    if (!match) {
      return line;
    }
    const oldTick = `\`${fromPath}\``;
    if (!match[1].includes(oldTick)) {
      return line;
    }
    const value = match[1].replaceAll(oldTick, `\`${toPath}\``);
    return `- **Where:** ${value}`;
  });
}

function addHealAnnotationOnly(
  lines: string[],
  date: string,
  detail: string,
): { lines: string[]; changed: boolean } {
  if (entryHasHealAnnotation(lines, detail)) {
    return { lines, changed: false };
  }
  const annotation = healAnnotationLine(date, detail);
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }
  trimmed.push("", annotation);
  return { lines: trimmed, changed: true };
}

function patchEntryBlock(
  lines: string[],
  newStatus: string,
  date: string,
  detail: string,
): { lines: string[]; changed: boolean } {
  const statusLines = setStatusInLines(lines, newStatus);
  const statusChanged = statusLines.some((line, i) => line !== lines[i]);
  if (entryHasHealAnnotation(lines, detail)) {
    return { lines: statusChanged ? statusLines : lines, changed: statusChanged };
  }
  const annotation = healAnnotationLine(date, detail);
  const trimmed = [...statusLines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }
  trimmed.push("", annotation);
  return { lines: trimmed, changed: true };
}

function patchMarkdownByEntryId(
  markdown: string,
  entryId: string,
  patch: (entryLines: string[]) => { lines: string[]; changed: boolean },
): { markdown: string; changed: boolean } {
  const out: string[] = [];
  let inTarget = false;
  let entryLines: string[] = [];
  let changed = false;
  let sawEntry = false;

  for (const line of markdown.split(/\r?\n/u)) {
    const heading = ENTRY_HEADING.exec(line);
    if (heading) {
      if (inTarget) {
        const result = patch(entryLines);
        if (result.changed) {
          changed = true;
        }
        out.push(...result.lines);
        entryLines = [];
        inTarget = false;
      }
      if (heading[1] === entryId) {
        sawEntry = true;
        inTarget = true;
        out.push(line);
        continue;
      }
    }
    if (inTarget) {
      entryLines.push(line);
      continue;
    }
    out.push(line);
  }

  if (inTarget) {
    const result = patch(entryLines);
    if (result.changed) {
      changed = true;
    }
    out.push(...result.lines);
  }

  if (!sawEntry) {
    return { markdown, changed: false };
  }

  const joined = out.join("\n");
  return { markdown: markdown.endsWith("\n") ? joined + "\n" : joined, changed };
}

function updateLedgerEntry(
  entries: LedgerEntry[],
  id: string,
  status: LedgerEntry["status"],
  date: string,
): { entries: LedgerEntry[]; changed: boolean } {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    if (entry.status === status && entry.updated === date) {
      return entry;
    }
    changed = true;
    return { ...entry, status, updated: date };
  });
  return { entries: next, changed };
}

function formatReport(report: DriftReport, healDate: string, changes: ApplyChange[]): string {
  const lines: string[] = [
    `# Memory drift report — ${healDate}`,
    "",
    `Reconciled \`${report.sinceSha.slice(0, 7)}\` → \`${report.headSha.slice(0, 7)}\` (${report.commitCount} commit${report.commitCount === 1 ? "" : "s"}${report.capped ? ", capped history window" : ""}).`,
    "",
  ];

  if (changes.length > 0) {
    lines.push("## Applied changes", "");
    for (const change of changes) {
      const label =
        change.kind === "observation_closed"
          ? "Observation closed"
          : change.kind === "decision_superseded"
            ? "Decision superseded"
            : change.kind === "observation_repointed"
              ? "Observation re-pointed"
              : "CONTEXT re-pointed";
      lines.push(`- **${change.id}** — ${change.title} (${label})`, `  - ${change.detail}`, "");
    }
  } else {
    lines.push("_No ledger entries required status changes._", "");
  }

  if (report.staleContextPaths.length > 0) {
    lines.push("## Stale CONTEXT paths", "");
    for (const stale of report.staleContextPaths) {
      lines.push(`- \`${stale.path}\` (${stale.reason}): ${stale.detail}`);
    }
    lines.push("");
  }

  if (report.ledgerMismatches.length > 0) {
    lines.push("## Ledger mismatches (manual fix)", "");
    for (const mismatch of report.ledgerMismatches) {
      lines.push(`- ${mismatch.message}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function reportFilePath(projectDir: string, healDate: string): string {
  return join(brainDir(projectDir), "reports", `${healDate}.md`);
}

/**
 * Apply a drift report: annotate markdown, update brain.json, write a dated report,
 * and advance `last_reconciled_sha`. Only writes inside `.brain/`.
 */
export function applyDriftReport(
  projectDir: string,
  report: DriftReport,
  options: { dryRun?: boolean; now?: Date } = {},
): ApplyResult {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const healDate = now.toISOString().slice(0, 10);

  const ledger = readLedger(projectDir);
  const previousReconciledSha = ledger.last_reconciled_sha;

  const changes: ApplyChange[] = [];
  let decisionsMd = readBrainFile(projectDir, DECISIONS_FILE);
  let observationsMd = readBrainFile(projectDir, OBSERVATIONS_FILE);
  let decisionsChanged = false;
  let observationsChanged = false;
  let contextChanged = false;
  let ledgerChanged = false;
  let contextMd = readBrainFile(projectDir, CONTEXT_FILE);
  let nextLedger: Ledger = { ...ledger, decisions: [...ledger.decisions], observations: [...ledger.observations] };

  const repointedObservations = new Map<string, ObservationRepointBatch>();
  for (const candidate of report.observationRepoints) {
    let batch = repointedObservations.get(candidate.observationId);
    if (!batch) {
      batch = { title: candidate.title, details: [] };
      repointedObservations.set(candidate.observationId, batch);
    }
    batch.details.push(candidate);
  }

  for (const [observationId, batch] of repointedObservations) {
    const detail = batch.details.map((d) => d.detail).join("; ");
    const patched = patchMarkdownByEntryId(observationsMd, observationId, (lines) => {
      let nextLines = lines;
      let changed = false;
      for (const item of batch.details) {
        const repointed = repointWhereInLines(nextLines, item.fromPath, item.toPath);
        if (repointed.some((line, i) => line !== nextLines[i])) {
          changed = true;
          nextLines = repointed;
        }
      }
      const annotated = addHealAnnotationOnly(nextLines, healDate, detail);
      if (annotated.changed) {
        changed = true;
        nextLines = annotated.lines;
      }
      return { lines: nextLines, changed };
    });
    if (patched.changed) {
      observationsChanged = true;
      observationsMd = patched.markdown;
    }
    const ledgerPatch = touchLedgerEntry(nextLedger.observations, observationId, healDate);
    if (ledgerPatch.changed) {
      ledgerChanged = true;
      nextLedger = { ...nextLedger, observations: ledgerPatch.entries };
    }
    if (patched.changed || ledgerPatch.changed) {
      changes.push({
        kind: "observation_repointed",
        id: observationId,
        title: batch.title,
        detail,
      });
    }
  }

  const contextRepointDetails: string[] = [];
  for (const candidate of report.contextRepoints) {
    const tickFrom = `\`${candidate.fromPath}\``;
    const tickTo = `\`${candidate.toPath}\``;
    if (contextMd.includes(tickFrom)) {
      contextMd = contextMd.replaceAll(tickFrom, tickTo);
      contextChanged = true;
      contextRepointDetails.push(candidate.detail);
    }
  }
  if (contextRepointDetails.length > 0) {
    const detail = contextRepointDetails.join("; ");
    const annotation = healAnnotationLine(healDate, detail);
    if (!contextMd.includes(annotation)) {
      contextMd = `${contextMd.trimEnd()}\n\n${annotation}\n`;
      contextChanged = true;
    }
    changes.push({
      kind: "context_repointed",
      id: "CONTEXT.md",
      title: "path references",
      detail,
    });
  }

  for (const candidate of report.closeCandidates) {
    const detail = candidate.detail;
    const patched = patchMarkdownByEntryId(observationsMd, candidate.observationId, (lines) =>
      patchEntryBlock(lines, "fixed", healDate, detail),
    );
    if (patched.changed) {
      observationsChanged = true;
      observationsMd = patched.markdown;
    }
    const ledgerPatch = updateLedgerEntry(
      nextLedger.observations,
      candidate.observationId,
      "fixed",
      healDate,
    );
    if (ledgerPatch.changed) {
      ledgerChanged = true;
      nextLedger = { ...nextLedger, observations: ledgerPatch.entries };
    }
    if (patched.changed || ledgerPatch.changed) {
      changes.push({
        kind: "observation_closed",
        id: candidate.observationId,
        title: candidate.title,
        detail,
      });
    }
  }

  for (const candidate of report.supersedeCandidates) {
    const detail = candidate.detail;
    const patched = patchMarkdownByEntryId(decisionsMd, candidate.decisionId, (lines) =>
      patchEntryBlock(lines, "superseded", healDate, detail),
    );
    if (patched.changed) {
      decisionsChanged = true;
      decisionsMd = patched.markdown;
    }
    const ledgerPatch = updateLedgerEntry(
      nextLedger.decisions,
      candidate.decisionId,
      "superseded",
      healDate,
    );
    if (ledgerPatch.changed) {
      ledgerChanged = true;
      nextLedger = { ...nextLedger, decisions: ledgerPatch.entries };
    }
    if (patched.changed || ledgerPatch.changed) {
      changes.push({
        kind: "decision_superseded",
        id: candidate.decisionId,
        title: candidate.title,
        detail,
      });
    }
  }

  const shouldAdvanceSha = previousReconciledSha !== report.headSha;
  if (shouldAdvanceSha) {
    nextLedger = { ...nextLedger, last_reconciled_sha: report.headSha };
    ledgerChanged = true;
  }

  const hasReportContent =
    changes.length > 0 ||
    report.staleContextPaths.length > 0 ||
    report.ledgerMismatches.length > 0 ||
    shouldAdvanceSha;

  const reportPath = hasReportContent ? reportFilePath(projectDir, healDate) : null;
  const reportBody = reportPath ? formatReport(report, healDate, changes) : null;

  if (!dryRun) {
    const dir = brainDir(projectDir);
    if (decisionsChanged) {
      writeFileSync(join(dir, DECISIONS_FILE), decisionsMd, "utf8");
    }
    if (observationsChanged) {
      writeFileSync(join(dir, OBSERVATIONS_FILE), observationsMd, "utf8");
    }
    if (contextChanged) {
      writeFileSync(join(dir, CONTEXT_FILE), contextMd, "utf8");
    }
    if (ledgerChanged) {
      writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(nextLedger, null, 2) + "\n", "utf8");
    }
    if (reportPath && reportBody) {
      const reportsDir = join(dir, "reports");
      mkdirSync(reportsDir, { recursive: true });
      if (existsSync(reportPath)) {
        const existing = readFileSync(reportPath, "utf8");
        const time = now.toISOString().slice(11, 16);
        writeFileSync(
          reportPath,
          `${existing.trimEnd()}\n\n---\n\n## Additional heal at ${time} UTC\n\n${reportBody}`,
          "utf8",
        );
      } else {
        writeFileSync(reportPath, reportBody, "utf8");
      }
    }
  }

  return {
    dryRun,
    headSha: report.headSha,
    previousReconciledSha,
    advancedReconciledSha: shouldAdvanceSha,
    reportPath,
    changes,
    wroteDecisions: decisionsChanged,
    wroteObservations: observationsChanged,
    wroteContext: contextChanged,
    wroteLedger: ledgerChanged,
  };
}

function touchLedgerEntry(
  entries: LedgerEntry[],
  id: string,
  date: string,
): { entries: LedgerEntry[]; changed: boolean } {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    if (entry.updated === date) {
      return entry;
    }
    changed = true;
    return { ...entry, updated: date };
  });
  return { entries: next, changed };
}

function readBrainFile(projectDir: string, fileName: string): string {
  const path = join(brainDir(projectDir), fileName);
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}
