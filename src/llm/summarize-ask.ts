import type { AskSearchResult } from "../ask/retrieve.js";
import { chatCompletion, type LlmClientDeps } from "./client.js";
import type { LlmConfig } from "./config.js";

function askContextPayload(result: AskSearchResult): string {
  const lines: string[] = [`query: ${result.query}`, `hits: ${result.hits.length}`];
  for (const hit of result.hits) {
    lines.push(
      `- [${hit.score}] ${hit.project} ${hit.file} — ${hit.heading}${hit.excerpt ? `: ${hit.excerpt}` : ""}`,
    );
  }
  return lines.join("\n");
}

const ASK_SYSTEM = `You answer a developer's question using only the retrieved brain memory snippets.
Be concise and practical. If snippets are insufficient, say what is missing. Plain text, no markdown headings.`;

export async function summarizeAskResult(
  result: AskSearchResult,
  config: LlmConfig,
  deps: LlmClientDeps = {},
): Promise<string> {
  return chatCompletion(
    config,
    [
      { role: "system", content: ASK_SYSTEM },
      {
        role: "user",
        content: `Question: ${result.query}\n\nRetrieved snippets:\n${askContextPayload(result)}`,
      },
    ],
    deps,
  );
}
