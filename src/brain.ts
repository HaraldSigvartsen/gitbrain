import { join } from "node:path";

/** Directory where a project's memory lives, relative to the project root. */
export const BRAIN_DIR = ".brain";

export const CONTEXT_FILE = "CONTEXT.md";
export const DECISIONS_FILE = "DECISIONS.md";
export const HANDOFF_FILE = "HANDOFF.md";
export const OBSERVATIONS_FILE = "OBSERVATIONS.md";
/** Machine-readable index of the markdown files. The markdown is the source of truth. */
export const LEDGER_FILE = "brain.json";

export const BRAIN_FILES = [
  CONTEXT_FILE,
  DECISIONS_FILE,
  HANDOFF_FILE,
  OBSERVATIONS_FILE,
  LEDGER_FILE,
] as const;

export type BrainFile = (typeof BRAIN_FILES)[number];

export function brainDir(projectDir: string): string {
  return join(projectDir, BRAIN_DIR);
}

export type DecisionStatus = "active" | "superseded" | "closed";
export type ObservationStatus = "open" | "fixed" | "wontfix";

export interface LedgerEntry {
  /** `D-0001` for decisions, `O-0001` for observations. Sequential, never reused. */
  id: string;
  title: string;
  status: DecisionStatus | ObservationStatus;
  /** ISO date of the last status change. */
  updated: string;
}

export interface Ledger {
  version: 1;
  project: string;
  /** ISO timestamp of `brain init`. */
  created: string;
  /** Git SHA the memory was last reconciled against; `null` until the first `brain heal`. */
  last_reconciled_sha: string | null;
  decisions: LedgerEntry[];
  observations: LedgerEntry[];
}
