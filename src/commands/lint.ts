import { lintBrain, type LintIssue, type LintResult } from "../brain/lint.js";

export type { LintIssue, LintResult };

export function runLint(projectDir: string): LintResult {
  return lintBrain(projectDir);
}

export function formatLintHumanOutput(result: LintResult): string {
  if (result.issues.length === 0) {
    return "✓ .brain memory passes lint (no issues).";
  }
  const lines = ["Lint found issues:", ""];
  for (const issue of result.issues) {
    const location = issue.id ? `${issue.id} · ` : "";
    lines.push(`✖ ${location}${issue.message}`);
  }
  lines.push("");
  lines.push(`${result.errorCount} error(s)`);
  return lines.join("\n");
}

export function lintResultToJson(result: LintResult): {
  ok: boolean;
  errorCount: number;
  issues: LintIssue[];
} {
  return {
    ok: result.errorCount === 0,
    errorCount: result.errorCount,
    issues: result.issues,
  };
}
