import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTEXT_FILE,
  DECISIONS_FILE,
  OBSERVATIONS_FILE,
  brainDir,
  type DecisionStatus,
  type Ledger,
  type ObservationStatus,
} from "../brain.js";
import { readLedger } from "../commands/status.js";

export type ObservationPriority = "CRITICAL" | "IMPORTANT" | "OPPORTUNITY" | "MINOR";

export interface ParsedDecision {
  id: string;
  title: string;
  status: DecisionStatus;
  date?: string;
  /** Repo paths from Context / Choice backticks — used by drift detection. */
  subjectPaths: string[];
}

export interface ParsedObservation {
  id: string;
  title: string;
  status: ObservationStatus;
  priority?: ObservationPriority;
  /** Paths from the `Where:` field (backtick-wrapped in the markdown). */
  where: string[];
  found?: string;
}

export type LedgerMismatchKind =
  | "decision_missing_in_ledger"
  | "decision_missing_in_markdown"
  | "decision_title_mismatch"
  | "decision_status_mismatch"
  | "observation_missing_in_ledger"
  | "observation_missing_in_markdown"
  | "observation_title_mismatch"
  | "observation_status_mismatch";

export interface LedgerMismatch {
  kind: LedgerMismatchKind;
  id: string;
  message: string;
}

export interface ParsedBrain {
  decisions: ParsedDecision[];
  observations: ParsedObservation[];
  /** Repo-relative paths mentioned in CONTEXT.md (architecture map and inline references). */
  contextPaths: string[];
  ledgerMismatches: LedgerMismatch[];
}

const ENTRY_HEADING = /^## ((?:D|O)-\d{4}) — (.+)$/;

const DECISION_STATUSES = new Set<DecisionStatus>(["active", "superseded", "closed"]);
const OBSERVATION_STATUSES = new Set<ObservationStatus>(["open", "fixed", "wontfix"]);
const OBSERVATION_PRIORITIES = new Set<ObservationPriority>([
  "CRITICAL",
  "IMPORTANT",
  "OPPORTUNITY",
  "MINOR",
]);

function stripHtmlComment(value: string): string {
  return value.replace(/\s*<!--[\s\S]*?-->/g, "").trim();
}

function extractBacktickPaths(value: string): string[] {
  const paths: string[] = [];
  const re = /`([^`]+)`/g;
  for (const match of value.matchAll(re)) {
    const normalized = normalizeContextPath(match[1]);
    if (normalized) {
      paths.push(normalized);
    }
  }
  return paths;
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = /^\s*-\s*\*\*([^:*]+):\*\*\s*(.+)$/.exec(line);
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

export function parseDecisionsMarkdown(markdown: string): ParsedDecision[] {
  const decisions: ParsedDecision[] = [];
  for (const entry of splitEntries(markdown)) {
    if (!entry.id.startsWith("D-")) {
      continue;
    }
    const fields = fieldsFromLines(entry.lines);
    const statusRaw = fields.get("status")?.toLowerCase();
    if (!statusRaw || !DECISION_STATUSES.has(statusRaw as DecisionStatus)) {
      continue;
    }
    const subjectPaths = new Set<string>();
    for (const key of ["context", "choice"] as const) {
      const value = fields.get(key);
      if (value) {
        for (const path of extractBacktickPaths(value)) {
          subjectPaths.add(path);
        }
      }
    }
    const decision: ParsedDecision = {
      id: entry.id,
      title: entry.title,
      status: statusRaw as DecisionStatus,
      subjectPaths: [...subjectPaths].sort(),
    };
    const date = fields.get("date");
    if (date) {
      decision.date = date;
    }
    decisions.push(decision);
  }
  return decisions;
}

export function parseObservationsMarkdown(markdown: string): ParsedObservation[] {
  const observations: ParsedObservation[] = [];
  for (const entry of splitEntries(markdown)) {
    if (!entry.id.startsWith("O-")) {
      continue;
    }
    const fields = fieldsFromLines(entry.lines);
    const statusRaw = fields.get("status")?.toLowerCase();
    if (!statusRaw || !OBSERVATION_STATUSES.has(statusRaw as ObservationStatus)) {
      continue;
    }
    const observation: ParsedObservation = {
      id: entry.id,
      title: entry.title,
      status: statusRaw as ObservationStatus,
      where: [],
    };
    const priorityRaw = fields.get("priority")?.toUpperCase();
    if (priorityRaw && OBSERVATION_PRIORITIES.has(priorityRaw as ObservationPriority)) {
      observation.priority = priorityRaw as ObservationPriority;
    }
    const whereValue = fields.get("where");
    if (whereValue) {
      observation.where = extractBacktickPaths(whereValue);
    }
    const found = fields.get("found");
    if (found) {
      observation.found = found;
    }
    observations.push(observation);
  }
  return observations;
}

/** True when a backtick span in CONTEXT.md is likely a repo path (not a command name). */
export function looksLikeRepoPath(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || /\s/u.test(trimmed)) {
    return false;
  }
  if (trimmed.includes("/")) {
    return /^[\w./@~$-]+$/u.test(trimmed);
  }
  return /^[\w@~$-]+\.[\w.-]+$/u.test(trimmed);
}

export function normalizeContextPath(candidate: string): string | null {
  const trimmed = candidate.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!looksLikeRepoPath(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseContextPaths(markdown: string): string[] {
  const paths = new Set<string>();
  const re = /`([^`]+)`/g;
  for (const match of markdown.matchAll(re)) {
    const normalized = normalizeContextPath(match[1]);
    if (normalized) {
      paths.add(normalized);
    }
  }
  return [...paths].sort();
}

function reconcileDecisions(
  parsed: ParsedDecision[],
  ledger: Ledger,
): LedgerMismatch[] {
  const mismatches: LedgerMismatch[] = [];
  const ledgerById = new Map(ledger.decisions.map((d) => [d.id, d]));
  const parsedIds = new Set(parsed.map((d) => d.id));

  for (const decision of parsed) {
    const ledgerEntry = ledgerById.get(decision.id);
    if (!ledgerEntry) {
      mismatches.push({
        kind: "decision_missing_in_ledger",
        id: decision.id,
        message: `${decision.id} is in DECISIONS.md but not in brain.json`,
      });
      continue;
    }
    if (ledgerEntry.title !== decision.title) {
      mismatches.push({
        kind: "decision_title_mismatch",
        id: decision.id,
        message: `${decision.id} title differs: markdown "${decision.title}" vs ledger "${ledgerEntry.title}"`,
      });
    }
    if (ledgerEntry.status !== decision.status) {
      mismatches.push({
        kind: "decision_status_mismatch",
        id: decision.id,
        message: `${decision.id} status differs: markdown "${decision.status}" vs ledger "${ledgerEntry.status}"`,
      });
    }
  }

  for (const ledgerEntry of ledger.decisions) {
    if (!parsedIds.has(ledgerEntry.id)) {
      mismatches.push({
        kind: "decision_missing_in_markdown",
        id: ledgerEntry.id,
        message: `${ledgerEntry.id} is in brain.json but not in DECISIONS.md`,
      });
    }
  }

  return mismatches;
}

function reconcileObservations(
  parsed: ParsedObservation[],
  ledger: Ledger,
): LedgerMismatch[] {
  const mismatches: LedgerMismatch[] = [];
  const ledgerById = new Map(ledger.observations.map((o) => [o.id, o]));
  const parsedIds = new Set(parsed.map((o) => o.id));

  for (const observation of parsed) {
    const ledgerEntry = ledgerById.get(observation.id);
    if (!ledgerEntry) {
      mismatches.push({
        kind: "observation_missing_in_ledger",
        id: observation.id,
        message: `${observation.id} is in OBSERVATIONS.md but not in brain.json`,
      });
      continue;
    }
    if (ledgerEntry.title !== observation.title) {
      mismatches.push({
        kind: "observation_title_mismatch",
        id: observation.id,
        message: `${observation.id} title differs: markdown "${observation.title}" vs ledger "${ledgerEntry.title}"`,
      });
    }
    if (ledgerEntry.status !== observation.status) {
      mismatches.push({
        kind: "observation_status_mismatch",
        id: observation.id,
        message: `${observation.id} status differs: markdown "${observation.status}" vs ledger "${ledgerEntry.status}"`,
      });
    }
  }

  for (const ledgerEntry of ledger.observations) {
    if (!parsedIds.has(ledgerEntry.id)) {
      mismatches.push({
        kind: "observation_missing_in_markdown",
        id: ledgerEntry.id,
        message: `${ledgerEntry.id} is in brain.json but not in OBSERVATIONS.md`,
      });
    }
  }

  return mismatches;
}

export function reconcileLedger(
  ledger: Ledger,
  decisions: ParsedDecision[],
  observations: ParsedObservation[],
): LedgerMismatch[] {
  return [
    ...reconcileDecisions(decisions, ledger),
    ...reconcileObservations(observations, ledger),
  ];
}

function readBrainMarkdown(projectDir: string, fileName: string): string {
  const path = join(brainDir(projectDir), fileName);
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

/** Read `.brain/` markdown, parse entries and CONTEXT paths, and compare with brain.json. */
export function parseBrain(projectDir: string): ParsedBrain {
  const decisions = parseDecisionsMarkdown(readBrainMarkdown(projectDir, DECISIONS_FILE));
  const observations = parseObservationsMarkdown(
    readBrainMarkdown(projectDir, OBSERVATIONS_FILE),
  );
  const contextPaths = parseContextPaths(readBrainMarkdown(projectDir, CONTEXT_FILE));
  const ledger = readLedger(projectDir);
  const ledgerMismatches = reconcileLedger(ledger, decisions, observations);
  return { decisions, observations, contextPaths, ledgerMismatches };
}
