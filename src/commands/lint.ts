import { type CliTheme, createTheme } from "../cli/theme.js";
import { lintBrain, type LintIssue, type LintResult } from "../brain/lint.js";

export type { LintIssue, LintResult };

export function runLint(projectDir: string): LintResult {
  return lintBrain(projectDir);
}

export function formatLintHumanOutput(result: LintResult, theme: CliTheme = createTheme(false)): string {
  if (result.issues.length === 0) {
    return `${theme.success("✓")} .brain memory passes lint (no issues).`;
  }
  const lines = [theme.error("Lint found issues:"), ""];
  for (const issue of result.issues) {
    const location = issue.id ? `${issue.id} · ` : "";
    lines.push(`${theme.error("✖")} ${location}${issue.message}`);
  }
  lines.push("");
  lines.push(theme.error(`${result.errorCount} error(s)`));
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
