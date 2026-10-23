import type { LlmConfig } from "./config.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmClientDeps {
  fetchFn?: typeof fetch;
}

export async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  deps: LlmClientDeps = {},
): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  const url = `${config.baseUrl}/chat/completions`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint = body ? ` — ${body.slice(0, 200)}` : "";
    throw new Error(`LLM request failed (${response.status})${hint}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("LLM response had no message content");
  }
  return text;
}
