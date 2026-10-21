import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAIN_DIR,
  BRAIN_FILES,
  LEDGER_FILE,
  brainDir,
  type Ledger,
  type LedgerEntry,
} from "../brain.js";

export interface StatusResult {
  project: string;
  created: string;
  lastReconciledSha: string | null;
  /** Entry counts keyed by status, e.g. `{ active: 3, superseded: 1 }`. */
  decisions: Record<string, number>;
  observations: Record<string, number>;
  files: Array<{ name: string; present: boolean }>;
}

function countByStatus(entries: LedgerEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

export function readLedger(projectDir: string): Ledger {
  const ledgerPath = join(brainDir(projectDir), LEDGER_FILE);
  if (!existsSync(ledgerPath)) {
    throw new Error(
      `No ${BRAIN_DIR}/${LEDGER_FILE} found in ${projectDir}. Run \`brain init\` first.`,
    );
  }
  return JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
}

export function runStatus(projectDir: string): StatusResult {
  const ledger = readLedger(projectDir);
  const dir = brainDir(projectDir);
  return {
    project: ledger.project,
    created: ledger.created,
    lastReconciledSha: ledger.last_reconciled_sha,
    decisions: countByStatus(ledger.decisions),
    observations: countByStatus(ledger.observations),
    files: BRAIN_FILES.map((name) => ({ name, present: existsSync(join(dir, name)) })),
  };
}
