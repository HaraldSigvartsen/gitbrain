export interface LlmConfig {
  apiKey: string;
  /** OpenAI-compatible API root, e.g. `https://api.openai.com/v1` */
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Resolve LLM settings from the environment. Returns null when no API key is set.
 * Keys are never logged; callers must not print the config object.
 */
export function resolveLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const apiKey = (env.GITBRAIN_LLM_API_KEY ?? env.OPENAI_API_KEY)?.trim();
  if (!apiKey) return null;

  const baseRaw = (env.GITBRAIN_LLM_BASE_URL ?? DEFAULT_BASE_URL).trim();
  const baseUrl = baseRaw.replace(/\/+$/, "");
  const model = (env.GITBRAIN_LLM_MODEL ?? DEFAULT_MODEL).trim();

  return { apiKey, baseUrl, model };
}

export function requireLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  const config = resolveLlmConfig(env);
  if (!config) {
    throw new Error(
      "LLM summarisation needs an API key. Set GITBRAIN_LLM_API_KEY or OPENAI_API_KEY, " +
        "or omit --summarize.",
    );
  }
  return config;
}
