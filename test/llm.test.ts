import { describe, expect, it, vi } from "vitest";
import { runAsk } from "../src/commands/ask.js";
import { runHeal } from "../src/commands/heal.js";
import { requireLlmConfig, resolveLlmConfig } from "../src/llm/config.js";
import { chatCompletion } from "../src/llm/client.js";
import { summarizeAskResult } from "../src/llm/summarize-ask.js";
import { summarizeHealResult } from "../src/llm/summarize-heal.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_DIR, CONTEXT_FILE, LEDGER_FILE } from "../src/brain.js";
import { runInit } from "../src/commands/init.js";
import { readLedger } from "../src/commands/status.js";

function mockFetch(content: string) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  })) as typeof fetch;
}

describe("resolveLlmConfig", () => {
  it("returns null without a key", () => {
    expect(resolveLlmConfig({})).toBeNull();
  });

  it("prefers GITBRAIN_LLM_API_KEY and custom base URL", () => {
    const config = resolveLlmConfig({
      GITBRAIN_LLM_API_KEY: "sk-test",
      GITBRAIN_LLM_BASE_URL: "https://example.com/v1/",
      GITBRAIN_LLM_MODEL: "custom",
    });
    expect(config).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "custom",
    });
  });

  it("falls back to OPENAI_API_KEY", () => {
    const config = resolveLlmConfig({ OPENAI_API_KEY: "sk-openai" });
    expect(config?.apiKey).toBe("sk-openai");
  });

  it("requireLlmConfig throws a friendly error", () => {
    expect(() => requireLlmConfig({})).toThrow(/GITBRAIN_LLM_API_KEY/);
  });
});

describe("chatCompletion", () => {
  it("posts OpenAI-shaped JSON and returns assistant text", async () => {
    const fetchFn = mockFetch("Hello from the model");
    const config = { apiKey: "sk-x", baseUrl: "https://api.test/v1", model: "m" };
    const text = await chatCompletion(config, [{ role: "user", content: "hi" }], { fetchFn });
    expect(text).toBe("Hello from the model");
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-x");
  });

  it("surfaces HTTP errors", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "bad key",
    })) as typeof fetch;
    await expect(
      chatCompletion(
        { apiKey: "x", baseUrl: "https://api.test/v1", model: "m" },
        [{ role: "user", content: "hi" }],
        { fetchFn },
      ),
    ).rejects.toThrow(/401/);
  });
});

describe("summarizeHealResult", () => {
  it("includes drift facts in the user message", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gitbrain-llm-heal-"));
    execFileSync("git", ["init"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    runInit(repo);
    writeFileSync(
      join(repo, BRAIN_DIR, CONTEXT_FILE),
      "# ctx\n\n- `src/missing.ts` — gone\n",
      "utf8",
    );
    const ledger = readLedger(repo);
    writeFileSync(join(repo, BRAIN_DIR, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const result = runHeal(repo, { dryRun: true });
    const fetchFn = mockFetch("Drift summary");
    const summary = await summarizeHealResult(
      result,
      { apiKey: "k", baseUrl: "https://api.test/v1", model: "m" },
      { fetchFn },
    );
    expect(summary).toBe("Drift summary");
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toMatch(/stale CONTEXT/);
  });
});

describe("summarizeAskResult", () => {
  it("sends query and hit excerpts", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gitbrain-llm-ask-"));
    runInit(repo);
    writeFileSync(
      join(repo, BRAIN_DIR, CONTEXT_FILE),
      "# Project\n\n## Auth\nUses JWT for sessions.\n",
      "utf8",
    );
    const result = runAsk(repo, "JWT");
    const fetchFn = mockFetch("JWT is used for sessions.");
    const summary = await summarizeAskResult(
      result,
      { apiKey: "k", baseUrl: "https://api.test/v1", model: "m" },
      { fetchFn },
    );
    expect(summary).toContain("JWT");
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toMatch(/Question: JWT/);
  });
});
