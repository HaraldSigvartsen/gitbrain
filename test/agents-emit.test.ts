import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GITBRAIN_MARKER_BEGIN,
  GITBRAIN_MARKER_END,
} from "../src/agents/instruction.js";
import { emitAgentInstructions, parseAgentToolsList } from "../src/agents/emit.js";
import { runInit } from "../src/commands/init.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-"));
}

describe("parseAgentToolsList", () => {
  it("parses and dedupes tools", () => {
    expect(parseAgentToolsList("cursor, codex, cursor")).toEqual(["cursor", "codex"]);
  });

  it("rejects unknown tools", () => {
    expect(() => parseAgentToolsList("cursor,foo")).toThrow(/Unknown agent tool/u);
  });
});

describe("emitAgentInstructions", () => {
  it("creates cursor, AGENTS.md, and CLAUDE.md with a single marker block each", () => {
    const project = tmpProject();
    const files = emitAgentInstructions(project, ["cursor", "codex", "claude"]);

    expect(files.map((f) => f.path).sort()).toEqual([
      ".cursor/rules/gitbrain.mdc",
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(files.every((f) => f.action === "created")).toBe(true);

    const mdc = readFileSync(join(project, ".cursor/rules/gitbrain.mdc"), "utf8");
    expect(mdc).toMatch(/^---\ndescription: gitbrain memory/u);
    expect(countMarkers(mdc)).toBe(1);

    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(countMarkers(agents)).toBe(1);
    expect(agents).toContain("This project uses gitbrain memory.");
  });

  it("updates marker blocks without duplicating on re-run", () => {
    const project = tmpProject();
    emitAgentInstructions(project, ["codex"]);
    const first = readFileSync(join(project, "AGENTS.md"), "utf8");

    emitAgentInstructions(project, ["codex"]);
    const second = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(countMarkers(second)).toBe(1);
    expect(second).toBe(first);
  });

  it("appends a marker block to an existing AGENTS.md without markers", () => {
    const project = tmpProject();
    writeFileSync(join(project, "AGENTS.md"), "# Team agents\n", "utf8");
    emitAgentInstructions(project, ["codex"]);
    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/# Team agents/);
    expect(countMarkers(agents)).toBe(1);
  });
});

describe("brain init --agents", () => {
  it("scaffolds brain and agent files together", () => {
    const project = tmpProject();
    const result = runInit(project, new Date("2026-10-22T12:00:00Z"), {
      agents: ["cursor", "codex", "claude"],
    });
    expect(result.created.length).toBe(5);
    expect(result.agentFiles).toHaveLength(3);
    expect(existsSync(join(project, ".cursor/rules/gitbrain.mdc"))).toBe(true);
  });

  it("refreshes agent snippets when .brain/ already exists", () => {
    const project = tmpProject();
    runInit(project);
    const result = runInit(project, undefined, { agents: ["codex"] });
    expect(result.created).toEqual([]);
    expect(result.agentFiles).toEqual([{ path: "AGENTS.md", action: "created" }]);
    const again = runInit(project, undefined, { agents: ["codex"] });
    expect(again.agentFiles[0]?.action).toBe("updated");
  });
});

function countMarkers(text: string): number {
  const begins = text.split(GITBRAIN_MARKER_BEGIN).length - 1;
  const ends = text.split(GITBRAIN_MARKER_END).length - 1;
  expect(begins).toBe(ends);
  return begins;
}
