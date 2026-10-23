import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverBrainRoots, runAskSearch } from "../src/ask/retrieve.js";
import { askResultToJson, formatAskHumanOutput, runAsk } from "../src/commands/ask.js";
import { runInit } from "../src/commands/init.js";
import { BRAIN_DIR, DECISIONS_FILE } from "../src/brain.js";
import { ensureDistBuilt } from "./ensure-dist.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-ask-"));
}

function appendDecision(project: string, block: string): void {
  const path = join(project, BRAIN_DIR, DECISIONS_FILE);
  writeFileSync(path, block, { flag: "a" });
}

describe("ask retrieve", () => {
  it("ranks a matching decision heading above unrelated sections", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `
## D-0001 — Durable Objects for sessions
- **Date:** 2026-01-01
- **Status:** active
- **Context:** sessions need consistency
- **Choice:** use Durable Objects
- **Consequences:** per-object billing
`,
    );

    const result = runAskSearch(project, "durable objects");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].heading).toContain("Durable Objects");
    expect(result.hits[0].score).toBeGreaterThan(0);
  });

  it("returns stable ordering for the same query", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `
## D-0001 — Alpha topic
- **Status:** active
- **Context:** alpha
- **Choice:** a
- **Consequences:** a

## D-0002 — Beta topic
- **Status:** active
- **Context:** beta
- **Choice:** b
- **Consequences:** b
`,
    );

    const a = runAskSearch(project, "topic");
    const b = runAskSearch(project, "topic");
    expect(a.hits.map((h) => h.heading)).toEqual(b.hits.map((h) => h.heading));
  });

  it("discovers sibling brains with --all", () => {
    const workspace = mkdtempSync(join(tmpdir(), "gitbrain-ask-ws-"));
    const alpha = join(workspace, "alpha");
    const beta = join(workspace, "beta");
    mkdirSync(alpha);
    mkdirSync(beta);
    runInit(alpha);
    runInit(beta);
    appendDecision(
      beta,
      `
## D-0001 — Unique zebra keyword
- **Date:** 2026-01-01
- **Status:** active
- **Context:** c
- **Choice:** c
- **Consequences:** c
`,
    );

    const roots = discoverBrainRoots(alpha, true);
    expect(roots.map((r) => r.label).sort()).toEqual(["alpha", "beta"]);

    const result = runAskSearch(alpha, "zebra", { all: true });
    expect(result.hits.some((h) => h.project === "beta")).toBe(true);
  });

  it("rejects empty queries", () => {
    const project = tmpProject();
    runInit(project);
    expect(() => runAskSearch(project, "   ")).toThrow(/required/i);
    expect(() => runAskSearch(project, "a")).toThrow(/2\+ characters/i);
  });

  it("formats human output and JSON", () => {
    const project = tmpProject();
    runInit(project);
    const result = runAsk(project, "memory");
    const text = formatAskHumanOutput(result);
    expect(text).toMatch(/match/i);
    const json = askResultToJson(result);
    expect(json.query).toBe("memory");
    expect(Array.isArray(json.hits)).toBe(true);
  });
});

describe("brain ask CLI", () => {
  let cliPath: string;

  beforeAll(() => {
    cliPath = ensureDistBuilt();
  });

  it("runs multi-word queries from the project root", () => {
    const project = tmpProject();
    runInit(project);
    appendDecision(
      project,
      `
## D-0001 — Checkout queue consumer
- **Date:** 2026-01-01
- **Status:** active
- **Context:** checkout
- **Choice:** queue
- **Consequences:** none
`,
    );

    const stdout = execFileSync("node", [cliPath, "ask", project, "checkout", "queue"], {
      encoding: "utf8",
    });
    expect(stdout).toContain("Checkout queue");
  });
});
