import { runAskSearch, type AskHit, type AskSearchResult } from "../ask/retrieve.js";

export type { AskHit, AskSearchResult };

export interface RunAskOptions {
  all?: boolean;
  limit?: number;
}

export function runAsk(projectDir: string, query: string, options: RunAskOptions = {}): AskSearchResult {
  return runAskSearch(projectDir, query, options);
}

export function formatAskHumanOutput(result: AskSearchResult): string {
  const scope =
    result.roots.length === 1
      ? result.roots[0].label
      : `${result.roots.length} projects (${result.roots.map((r) => r.label).join(", ")})`;

  if (result.hits.length === 0) {
    return `No matches for "${result.query}" in ${scope}.`;
  }

  const lines = [`${result.hits.length} match(es) for "${result.query}" in ${scope}:`, ""];
  for (const hit of result.hits) {
    lines.push(`[${hit.score}] ${hit.project} · ${hit.file} · ${hit.heading}`);
    if (hit.excerpt) {
      lines.push(`  ${hit.excerpt}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function askResultToJson(result: AskSearchResult): {
  query: string;
  projects: string[];
  hitCount: number;
  hits: AskHit[];
} {
  return {
    query: result.query,
    projects: result.roots.map((r) => r.label),
    hitCount: result.hits.length,
    hits: result.hits,
  };
}
