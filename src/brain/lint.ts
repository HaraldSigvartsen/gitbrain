import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTEXT_FILE,
  DECISIONS_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
  brainDir,
  type Ledger,
} from "../brain.js";
import { readLedger } from "../commands/status.js";
import {
  parseDecisionsMarkdown,
  parseObservationsMarkdown,
  reconcileLedger,
  type LedgerMismatch,
} from "./parse.js";

const ENTRY_HEADING = /^## ((?:D|O)-\d{4}) — (.+)$/u;

const DECISION_REQUIRED_FIELDS = ["date", "status", "context", "choice", "consequences"] as const;
const OBSERVATION_REQUIRED_FIELDS = ["priority", "status", "where", "found", "detail"] as const;

const DECISION_STATUSES = new Set(["active", "superseded", "closed"]);
const OBSERVATION_STATUSES = new Set(["open", "fixed", "wontfix"]);
const OBSERVATION_PRIORITIES = new Set(["CRITICAL", "IMPORTANT", "OPPORTUNITY", "MINOR"]);

export type LintIssueKind =
  | "duplicate_id_markdown"
  | "duplicate_id_ledger"
  | "wrong_prefix_in_file"
  | "sequence_gap"
  | "missing_field"
  | "invalid_status"
  | "invalid_priority"
  | "ledger_mismatch";

export interface LintIssue {
  kind: LintIssueKind;
  /** Repo-relative path under `.brain/`. */
  file: string;
  id?: string;
  message: string;
}

export interface LintResult {
  projectDir: string;
  issues: LintIssue[];
  errorCount: number;
}

function stripHtmlComment(value: string): string {
  return value.replace(/\s*<!--[\s\S]*?-->/g, "").trim();
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = /^\s*-\s*\*\*([^:*]+):\*\*\s*(.+)$/u.exec(line);
  if (!match) {
    return null;
  }
  return { key: match[1].trim(), value: stripHtmlComment(match[2].trim()) };
}

function splitEntries(markdown: string): Array<{ id: string; title: string; lines: string[] }> {
  const entries: Array<{ id: string; title: string; lines: string[] }> = [];
  let current: { id: string; title: string; lines: string[] } | null = null;

  for (const line of markdown.split(/\r?\n/u)) {
    const heading = ENTRY_HEADING.exec(line);
    if (heading) {
      if (current) {
        entries.push(current);
      }
      current = { id: heading[1], title: heading[2].trim(), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function fieldsFromLines(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const parsed = parseFieldLine(line);
    if (parsed) {
      fields.set(parsed.key.toLowerCase(), parsed.value);
    }
  }
  return fields;
}

function readBrainFile(projectDir: string, fileName: string): string {
  const path = join(brainDir(projectDir), fileName);
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

function pushDuplicateMarkdownIssues(
  issues: LintIssue[],
  file: string,
  entries: Array<{ id: string }>,
  expectedPrefix: "D-" | "O-",
): void {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.id.startsWith(expectedPrefix)) {
      continue;
    }
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      issues.push({
        kind: "duplicate_id_markdown",
        file,
        id,
        message: `${id} appears ${count} times in ${file}`,
      });
    }
  }
}

function pushWrongPrefixIssues(
  issues: LintIssue[],
  file: string,
  entries: Array<{ id: string }>,
  expectedPrefix: "D-" | "O-",
): void {
  const wrongPrefix = expectedPrefix === "D-" ? "O-" : "D-";
  for (const entry of entries) {
    if (entry.id.startsWith(wrongPrefix)) {
      issues.push({
        kind: "wrong_prefix_in_file",
        file,
        id: entry.id,
        message: `${entry.id} belongs in ${wrongPrefix === "D-" ? DECISIONS_FILE : OBSERVATIONS_FILE}, not ${file}`,
      });
    }
  }
}

function sequenceGaps(ids: string[]): number[] {
  const numbers = [...new Set(ids.map((id) => Number.parseInt(id.slice(2), 10)))].sort(
    (a, b) => a - b,
  );
  const gaps: number[] = [];
  if (numbers.length === 0) {
    return gaps;
  }
  for (let expected = 1; expected <= numbers[numbers.length - 1]; expected += 1) {
    if (!numbers.includes(expected)) {
      gaps.push(expected);
    }
  }
  return gaps;
}

function pushSequenceIssues(
  issues: LintIssue[],
  file: string,
  ids: string[],
  prefix: "D-" | "O-",
): void {
  const uniqueIds = [...new Set(ids.filter((id) => id.startsWith(prefix)))];
  for (const gap of sequenceGaps(uniqueIds)) {
    const missing = `${prefix}${String(gap).padStart(4, "0")}`;
    issues.push({
      kind: "sequence_gap",
      file,
      id: missing,
      message: `missing ${missing} in sequence (${file})`,
    });
  }
}

function pushMissingFieldIssues(
  issues: LintIssue[],
  file: string,
  entry: { id: string; lines: string[] },
  required: readonly string[],
): void {
  const fields = fieldsFromLines(entry.lines);
  for (const key of required) {
    const value = fields.get(key);
    if (!value) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      issues.push({
        kind: "missing_field",
        file,
        id: entry.id,
        message: `${entry.id} is missing required field **${label}:** in ${file}`,
      });
    }
  }
}

function lintDecisionEntries(markdown: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const entries = splitEntries(markdown);
  const decisionEntries = entries.filter((e) => e.id.startsWith("D-"));

  pushWrongPrefixIssues(issues, DECISIONS_FILE, entries, "D-");
  pushDuplicateMarkdownIssues(issues, DECISIONS_FILE, entries, "D-");
  pushSequenceIssues(issues, DECISIONS_FILE, decisionEntries.map((e) => e.id), "D-");

  for (const entry of decisionEntries) {
    pushMissingFieldIssues(issues, DECISIONS_FILE, entry, DECISION_REQUIRED_FIELDS);
    const fields = fieldsFromLines(entry.lines);
    const statusRaw = fields.get("status")?.toLowerCase();
    if (statusRaw && !DECISION_STATUSES.has(statusRaw)) {
      issues.push({
        kind: "invalid_status",
        file: DECISIONS_FILE,
        id: entry.id,
        message: `${entry.id} has invalid Status "${fields.get("status")}" (expected active | superseded | closed)`,
      });
    }
  }

  return issues;
}

function lintObservationEntries(markdown: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const entries = splitEntries(markdown);
  const observationEntries = entries.filter((e) => e.id.startsWith("O-"));

  pushWrongPrefixIssues(issues, OBSERVATIONS_FILE, entries, "O-");
  pushDuplicateMarkdownIssues(issues, OBSERVATIONS_FILE, entries, "O-");
  pushSequenceIssues(
    issues,
    OBSERVATIONS_FILE,
    observationEntries.map((e) => e.id),
    "O-",
  );

  for (const entry of observationEntries) {
    pushMissingFieldIssues(issues, OBSERVATIONS_FILE, entry, OBSERVATION_REQUIRED_FIELDS);
    const fields = fieldsFromLines(entry.lines);
    const statusRaw = fields.get("status")?.toLowerCase();
    if (statusRaw && !OBSERVATION_STATUSES.has(statusRaw)) {
      issues.push({
        kind: "invalid_status",
        file: OBSERVATIONS_FILE,
        id: entry.id,
        message: `${entry.id} has invalid Status "${fields.get("status")}" (expected open | fixed | wontfix)`,
      });
    }
    const priorityRaw = fields.get("priority")?.toUpperCase();
    if (priorityRaw && !OBSERVATION_PRIORITIES.has(priorityRaw)) {
      issues.push({
        kind: "invalid_priority",
        file: OBSERVATIONS_FILE,
        id: entry.id,
        message: `${entry.id} has invalid Priority "${fields.get("priority")}"`,
      });
    }
  }

  return issues;
}

function pushLedgerDuplicateIssues(
  issues: LintIssue[],
  ledgerEntries: Array<{ id: string }>,
  file: string,
): void {
  const counts = new Map<string, number>();
  for (const entry of ledgerEntries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      issues.push({
        kind: "duplicate_id_ledger",
        file,
        id,
        message: `${id} appears ${count} times in brain.json`,
      });
    }
  }
}

function mismatchToIssue(mismatch: LedgerMismatch): LintIssue {
  const file =
    mismatch.kind.startsWith("decision") ? DECISIONS_FILE : OBSERVATIONS_FILE;
  return {
    kind: "ledger_mismatch",
    file,
    id: mismatch.id,
    message: mismatch.message,
  };
}

/** Validate `.brain/` markdown and `brain.json` without touching git. */
export function lintBrain(projectDir: string): LintResult {
  readLedger(projectDir);

  const decisionsMd = readBrainFile(projectDir, DECISIONS_FILE);
  const observationsMd = readBrainFile(projectDir, OBSERVATIONS_FILE);

  const issues: LintIssue[] = [
    ...lintDecisionEntries(decisionsMd),
    ...lintObservationEntries(observationsMd),
  ];

  const ledger: Ledger = readLedger(projectDir);
  pushLedgerDuplicateIssues(issues, ledger.decisions, LEDGER_FILE);
  pushLedgerDuplicateIssues(issues, ledger.observations, LEDGER_FILE);
  pushSequenceIssues(
    issues,
    LEDGER_FILE,
    ledger.decisions.map((d) => d.id),
    "D-",
  );
  pushSequenceIssues(
    issues,
    LEDGER_FILE,
    ledger.observations.map((o) => o.id),
    "O-",
  );

  const decisions = parseDecisionsMarkdown(decisionsMd);
  const observations = parseObservationsMarkdown(observationsMd);
  for (const mismatch of reconcileLedger(ledger, decisions, observations)) {
    issues.push(mismatchToIssue(mismatch));
  }

  issues.sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    const idA = a.id ?? "";
    const idB = b.id ?? "";
    return idA.localeCompare(idB) || a.message.localeCompare(b.message);
  });

  return {
    projectDir,
    issues,
    errorCount: issues.length,
  };
}
