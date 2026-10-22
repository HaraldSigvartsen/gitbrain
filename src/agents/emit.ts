import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  GITBRAIN_INSTRUCTION_BODY,
  GITBRAIN_MARKER_BEGIN,
  GITBRAIN_MARKER_END,
} from "./instruction.js";

export const SUPPORTED_AGENT_TOOLS = [
  "cursor",
  "codex",
  "claude",
  "zcode",
  "opencode",
] as const;

export type AgentTool = (typeof SUPPORTED_AGENT_TOOLS)[number];

export interface EmittedAgentFile {
  /** Repo-relative path. */
  path: string;
  action: "created" | "updated";
}

const AGENTS_MD_TOOLS: AgentTool[] = ["codex", "zcode", "opencode"];

/** Parse a comma-separated tool list from the CLI. */
export function parseAgentToolsList(raw: string): AgentTool[] {
  const seen = new Set<AgentTool>();
  const out: AgentTool[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!SUPPORTED_AGENT_TOOLS.includes(id as AgentTool)) {
      throw new Error(
        `Unknown agent tool "${part.trim()}". ` +
          `Supported: ${SUPPORTED_AGENT_TOOLS.join(", ")}.`,
      );
    }
    const tool = id as AgentTool;
    if (!seen.has(tool)) {
      seen.add(tool);
      out.push(tool);
    }
  }
  if (!out.length) {
    throw new Error(
      `--agents requires at least one tool (${SUPPORTED_AGENT_TOOLS.join(", ")}).`,
    );
  }
  return out;
}

function markedBlock(body: string): string {
  return `${GITBRAIN_MARKER_BEGIN}\n${body}\n${GITBRAIN_MARKER_END}`;
}

function upsertMarkedContent(existing: string, body: string): string {
  const block = markedBlock(body);
  const begin = GITBRAIN_MARKER_BEGIN;
  const end = GITBRAIN_MARKER_END;
  if (existing.includes(begin) && existing.includes(end)) {
    const pattern = new RegExp(
      `${begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    return existing.replace(pattern, block);
  }
  const trimmed = existing.trimEnd();
  if (!trimmed) return `${block}\n`;
  return `${trimmed}\n\n${block}\n`;
}

function cursorFileContent(body: string): string {
  const block = markedBlock(body);
  return `---\ndescription: gitbrain memory\nalwaysApply: true\n---\n\n${block}\n`;
}

function upsertCursorFile(existing: string, body: string): string {
  const block = markedBlock(body);
  if (existing.includes(GITBRAIN_MARKER_BEGIN) && existing.includes(GITBRAIN_MARKER_END)) {
    const pattern = new RegExp(
      `${GITBRAIN_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${GITBRAIN_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    const withBlock = existing.replace(pattern, block);
    if (withBlock.includes("---")) return withBlock;
  }
  return cursorFileContent(body);
}

function pathsForTools(tools: AgentTool[]): Map<string, AgentTool> {
  const byPath = new Map<string, AgentTool>();
  for (const tool of tools) {
    if (tool === "cursor") {
      byPath.set(".cursor/rules/gitbrain.mdc", tool);
    } else if (tool === "claude") {
      byPath.set("CLAUDE.md", tool);
    } else if (AGENTS_MD_TOOLS.includes(tool)) {
      byPath.set("AGENTS.md", byPath.get("AGENTS.md") ?? tool);
    }
  }
  return byPath;
}

function writeAgentFile(
  projectDir: string,
  relPath: string,
  tool: AgentTool,
  body: string,
): EmittedAgentFile {
  const abs = join(projectDir, relPath);
  const existed = existsSync(abs);
  mkdirSync(dirname(abs), { recursive: true });
  const prior = existed ? readFileSync(abs, "utf8") : "";
  const next =
    tool === "cursor" ? upsertCursorFile(prior, body) : upsertMarkedContent(prior, body);
  writeFileSync(abs, next, "utf8");
  return { path: relPath, action: existed ? "updated" : "created" };
}

/** Write or update marker-delimited agent instruction files under `projectDir`. */
export function emitAgentInstructions(
  projectDir: string,
  tools: AgentTool[],
): EmittedAgentFile[] {
  const body = GITBRAIN_INSTRUCTION_BODY;
  const emitted: EmittedAgentFile[] = [];
  for (const [relPath, tool] of pathsForTools(tools)) {
    emitted.push(writeAgentFile(projectDir, relPath, tool, body));
  }
  return emitted;
}
