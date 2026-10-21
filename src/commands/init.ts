import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  BRAIN_DIR,
  CONTEXT_FILE,
  DECISIONS_FILE,
  HANDOFF_FILE,
  LEDGER_FILE,
  OBSERVATIONS_FILE,
  brainDir,
  type Ledger,
} from "../brain.js";
import {
  contextTemplate,
  decisionsTemplate,
  handoffTemplate,
  observationsTemplate,
} from "../templates.js";

export interface InitResult {
  project: string;
  /** Absolute path of the created `.brain/` directory. */
  dir: string;
  created: string[];
}

/** `name` from package.json (scope stripped), falling back to the directory name. */
export function detectProjectName(projectDir: string): string {
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name.trim()) {
        return pkg.name.split("/").pop() ?? pkg.name;
      }
    } catch {
      // Unparseable package.json — fall through to the directory name.
    }
  }
  return basename(projectDir) || "project";
}

export function runInit(projectDir: string, now: Date = new Date()): InitResult {
  const dir = brainDir(projectDir);
  if (existsSync(dir)) {
    throw new Error(
      `${BRAIN_DIR}/ already exists at ${dir} — refusing to overwrite. ` +
        `Delete it first if you really want to re-initialise.`,
    );
  }

  const project = detectProjectName(projectDir);
  const date = now.toISOString().slice(0, 10);
  const markdown: Array<[string, string]> = [
    [CONTEXT_FILE, contextTemplate(project, date)],
    [DECISIONS_FILE, decisionsTemplate(project, date)],
    [HANDOFF_FILE, handoffTemplate(project, date)],
    [OBSERVATIONS_FILE, observationsTemplate(project, date)],
  ];
  const ledger: Ledger = {
    version: 1,
    project,
    created: now.toISOString(),
    last_reconciled_sha: null,
    decisions: [],
    observations: [],
  };

  mkdirSync(dir, { recursive: true });
  for (const [name, content] of markdown) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(ledger, null, 2) + "\n", "utf8");

  return { project, dir, created: [...markdown.map(([name]) => name), LEDGER_FILE] };
}
