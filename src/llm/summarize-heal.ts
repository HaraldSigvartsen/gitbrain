import type { HealResult } from "../commands/heal.js";
import { chatCompletion, type LlmClientDeps } from "./client.js";
import type { LlmConfig } from "./config.js";

function healContextPayload(result: HealResult): string {
  const { report, apply, dryRun } = result;
  const lines: string[] = [
    `dryRun: ${dryRun}`,
    `commits since reconcile: ${report.commitCount}`,
    `capped window: ${report.capped}`,
    `changes applied or proposed: ${apply.changes.length}`,
  ];
  for (const change of apply.changes) {
    lines.push(`- ${change.kind} ${change.id} "${change.title}": ${change.detail}`);
  }
  for (const stale of report.staleContextPaths) {
    lines.push(`- stale CONTEXT path \`${stale.path}\`: ${stale.detail}`);
  }
  for (const mismatch of report.ledgerMismatches) {
    lines.push(`- ledger mismatch: ${mismatch.message}`);
  }
  if (
    apply.changes.length === 0 &&
    report.staleContextPaths.length === 0 &&
    report.ledgerMismatches.length === 0
  ) {
    lines.push("- no drift detected");
  }
  return lines.join("\n");
}

const HEAL_SYSTEM = `You summarise gitbrain heal drift reports for a developer.
Be concise (3–6 short bullets or one short paragraph). Mention what changed in project memory and what to review.
Do not invent code changes; only use the structured facts provided. Plain text, no markdown headings.`;

export async function summarizeHealResult(
  result: HealResult,
  config: LlmConfig,
  deps: LlmClientDeps = {},
): Promise<string> {
  return chatCompletion(
    config,
    [
      { role: "system", content: HEAL_SYSTEM },
      { role: "user", content: healContextPayload(result) },
    ],
    deps,
  );
}
