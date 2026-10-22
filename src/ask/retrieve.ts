import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  CONTEXT_FILE,
  DECISIONS_FILE,
  HANDOFF_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
  brainDir,
} from "../brain.js";
import { readLedger } from "../commands/status.js";

const SEARCHABLE_FILES = [CONTEXT_FILE, DECISIONS_FILE, HANDOFF_FILE, OBSERVATIONS_FILE] as const;

export interface BrainSearchRoot {
  /** Absolute path to the project directory that owns the brain. */
  projectDir: string;
  /** Human label (ledger project name or directory name). */
  label: string;
}

export interface AskHit {
  project: string;
  score: number;
  file: string;
  heading: string;
  excerpt: string;
}

export interface AskSearchResult {
  query: string;
  roots: BrainSearchRoot[];
  hits: AskHit[];
}

export interface AskSearchOptions {
  all?: boolean;
  limit?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function countTerm(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const found = text.indexOf(term, index);
    if (found === -1) break;
    count += 1;
    index = found + term.length;
  }
  return count;
}

function scoreSection(heading: string, body: string, terms: string[]): number {
  const h = heading.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += 4 * countTerm(h, term);
    score += countTerm(b, term);
  }
  return score;
}

function splitSections(content: string): Array<{ heading: string; body: string }> {
  const parts = content.split(/\n(?=## )/);
  const sections: Array<{ heading: string; body: string }> = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const first = lines[0] ?? "";
    if (first.startsWith("## ")) {
      sections.push({ heading: first.replace(/^##\s+/, "").trim(), body: lines.slice(1).join("\n").trim() });
    } else {
      sections.push({ heading: "(intro)", body: trimmed });
    }
  }
  return sections;
}

function excerpt(body: string, maxLen = 220): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1).trimEnd()}…`;
}

function projectLabel(projectDir: string): string {
  try {
    return readLedger(projectDir).project;
  } catch {
    return basename(projectDir);
  }
}

function hasBrain(projectDir: string): boolean {
  return existsSync(join(brainDir(projectDir), LEDGER_FILE));
}

/** Roots to search: current project, optionally every sibling directory under the same parent with a `.brain/`. */
export function discoverBrainRoots(projectDir: string, all: boolean): BrainSearchRoot[] {
  const root = resolve(projectDir);
  if (!hasBrain(root)) {
    throw new Error(
      `No .brain/${LEDGER_FILE} found in ${root}. Run \`brain init\` first.`,
    );
  }

  if (!all) {
    return [{ projectDir: root, label: projectLabel(root) }];
  }

  const parent = dirname(root);
  const siblings: BrainSearchRoot[] = [];
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [{ projectDir: root, label: projectLabel(root) }];
  }

  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue;
    const candidate = join(parent, name);
    try {
      if (!statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!hasBrain(candidate)) continue;
    siblings.push({ projectDir: candidate, label: projectLabel(candidate) });
  }

  if (siblings.length === 0) {
    return [{ projectDir: root, label: projectLabel(root) }];
  }
  return siblings;
}

function searchFile(
  projectLabel: string,
  fileName: string,
  content: string,
  terms: string[],
): AskHit[] {
  const hits: AskHit[] = [];
  for (const section of splitSections(content)) {
    const score = scoreSection(section.heading, section.body, terms);
    if (score <= 0) continue;
    hits.push({
      project: projectLabel,
      score,
      file: fileName,
      heading: section.heading,
      excerpt: excerpt(section.body),
    });
  }
  return hits;
}

export function searchBrains(
  roots: BrainSearchRoot[],
  query: string,
  options: { limit?: number } = {},
): AskSearchResult {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query is required.");
  }
  const terms = tokenize(trimmed);
  if (terms.length === 0) {
    throw new Error("Search query must include at least one word (2+ characters).");
  }

  const limit = options.limit ?? 10;
  const allHits: AskHit[] = [];

  for (const root of roots) {
    const dir = brainDir(root.projectDir);
    for (const fileName of SEARCHABLE_FILES) {
      const path = join(dir, fileName);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      allHits.push(...searchFile(root.label, fileName, content, terms));
    }
  }

  allHits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.project !== b.project) return a.project.localeCompare(b.project);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.heading.localeCompare(b.heading);
  });

  return {
    query: trimmed,
    roots,
    hits: allHits.slice(0, limit),
  };
}

export function runAskSearch(
  projectDir: string,
  query: string,
  options: AskSearchOptions = {},
): AskSearchResult {
  const roots = discoverBrainRoots(projectDir, options.all ?? false);
  return searchBrains(roots, query, { limit: options.limit });
}
