import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_DIR, LEDGER_FILE, type Ledger } from "../src/brain.js";
import {
  looksLikeRepoPath,
  normalizeContextPath,
  parseBrain,
  parseContextPaths,
  parseDecisionsMarkdown,
  parseObservationsMarkdown,
  reconcileLedger,
} from "../src/brain/parse.js";
import { runInit } from "../src/commands/init.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gitbrain-parse-"));
}

const SAMPLE_DECISIONS = `# proj — decision log

## D-0002 — Second decision
- **Date:** 2026-01-02
- **Status:** superseded
- **Context:** why
- **Choice:** what
- **Consequences:** effects

## D-0001 — First decision
- **Date:** 2026-01-01
- **Status:** active
`;

const SAMPLE_OBSERVATIONS = `# proj — observations

## O-0001 — Leaky abstraction
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** \`src/lib/leak.ts\` and \`src/lib/util.ts\`
- **Found:** 2026-02-01
- **Detail:** Something subtle

## O-0002 — Fixed typo
- **Priority:** MINOR
- **Status:** fixed
- **Where:** \`README.md\`
- **Found:** 2026-02-02
- **Detail:** n/a
`;

describe("parseDecisionsMarkdown", () => {
  it("extracts id, title, status, and date from entries", () => {
    const parsed = parseDecisionsMarkdown(SAMPLE_DECISIONS);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: "D-0002",
      title: "Second decision",
      status: "superseded",
      date: "2026-01-02",
    });
    expect(parsed[1]).toEqual({
      id: "D-0001",
      title: "First decision",
      status: "active",
      date: "2026-01-01",
    });
  });

  it("ignores indented template headings and entries without a valid status", () => {
    const md = `# x

    ## D-0099 — template example
    - **Status:** active

## D-0001 — Real
- **Status:** not-a-status
`;
    expect(parseDecisionsMarkdown(md)).toEqual([]);
  });
});

describe("parseObservationsMarkdown", () => {
  it("extracts id, title, status, priority, where paths, and found date", () => {
    const parsed = parseObservationsMarkdown(SAMPLE_OBSERVATIONS);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: "O-0001",
      title: "Leaky abstraction",
      status: "open",
      priority: "IMPORTANT",
      where: ["src/lib/leak.ts", "src/lib/util.ts"],
      found: "2026-02-01",
    });
    expect(parsed[1].where).toEqual(["README.md"]);
  });
});

describe("parseContextPaths", () => {
  it("collects backtick paths and ignores command-like spans", () => {
    const md = `# ctx

## Architecture map

- \`src/cli.ts\` — entry
- \`docs/logo.svg\` — art
- run \`brain heal\` sometimes
- \`package.json\` at root
`;
    expect(parseContextPaths(md)).toEqual([
      "docs/logo.svg",
      "package.json",
      "src/cli.ts",
    ]);
  });

  it("normalises Windows-style separators inside backticks", () => {
    expect(parseContextPaths("Uses `src\\\\foo\\\\bar.ts` here")).toEqual(["src/foo/bar.ts"]);
  });
});

describe("looksLikeRepoPath", () => {
  it("accepts slash paths and extension-only filenames", () => {
    expect(looksLikeRepoPath("src/a.ts")).toBe(true);
    expect(looksLikeRepoPath("package.json")).toBe(true);
    expect(looksLikeRepoPath("brain heal")).toBe(false);
    expect(looksLikeRepoPath("")).toBe(false);
  });
});

describe("normalizeContextPath", () => {
  it("returns null for non-path spans", () => {
    expect(normalizeContextPath("brain init")).toBeNull();
  });
});

describe("reconcileLedger", () => {
  it("reports missing entries and field mismatches", () => {
    const ledger: Ledger = {
      version: 1,
      project: "p",
      created: "2026-01-01T00:00:00.000Z",
      last_reconciled_sha: null,
      decisions: [
        {
          id: "D-0001",
          title: "Wrong title",
          status: "active",
          updated: "2026-01-01",
        },
        {
          id: "D-0003",
          title: "Only in ledger",
          status: "closed",
          updated: "2026-01-01",
        },
      ],
      observations: [],
    };
    const decisions = parseDecisionsMarkdown(`## D-0001 — First
- **Status:** superseded
## D-0002 — Only in markdown
- **Status:** active
`);
    const mismatches = reconcileLedger(ledger, decisions, []);
    const kinds = mismatches.map((m) => m.kind);
    expect(kinds).toContain("decision_title_mismatch");
    expect(kinds).toContain("decision_status_mismatch");
    expect(kinds).toContain("decision_missing_in_ledger");
    expect(kinds).toContain("decision_missing_in_markdown");
  });
});

describe("parseBrain", () => {
  it("reads this repo's .brain and finds no ledger mismatches", () => {
    const repoRoot = join(import.meta.dirname, "..");
    const parsed = parseBrain(repoRoot);
    expect(parsed.decisions.length).toBeGreaterThanOrEqual(4);
    expect(parsed.ledgerMismatches).toEqual([]);
    expect(parsed.contextPaths).toContain("src/cli.ts");
  });

  it("parses a fresh init project with added markdown entries", () => {
    const project = tmpProject();
    runInit(project, new Date("2026-10-21T10:30:00Z"));

    const decisionsPath = join(project, BRAIN_DIR, "DECISIONS.md");
    const observationsPath = join(project, BRAIN_DIR, "OBSERVATIONS.md");
    const contextPath = join(project, BRAIN_DIR, "CONTEXT.md");
    const ledgerPath = join(project, BRAIN_DIR, LEDGER_FILE);

    writeFileSync(
      decisionsPath,
      `${readFileSync(decisionsPath, "utf8")}

## D-0001 — Use SQLite
- **Date:** 2026-10-22
- **Status:** active
- **Context:** storage
- **Choice:** sqlite
- **Consequences:** files
`,
    );
    writeFileSync(
      observationsPath,
      `${readFileSync(observationsPath, "utf8")}

## O-0001 — Slow query
- **Priority:** MINOR
- **Status:** open
- **Where:** \`src/db/query.ts\`
- **Found:** 2026-10-22
- **Detail:** needs index
`,
    );
    writeFileSync(
      contextPath,
      `${readFileSync(contextPath, "utf8")}

## Architecture map

- \`src/db/query.ts\` — database access
`,
    );

    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
    ledger.decisions.push({
      id: "D-0001",
      title: "Use SQLite",
      status: "active",
      updated: "2026-10-22",
    });
    ledger.observations.push({
      id: "O-0001",
      title: "Slow query",
      status: "open",
      updated: "2026-10-22",
    });
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

    const parsed = parseBrain(project);
    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.observations[0].where).toEqual(["src/db/query.ts"]);
    expect(parsed.contextPaths).toContain("src/db/query.ts");
    expect(parsed.ledgerMismatches).toEqual([]);
  });
});
