# gitbrain — project context

> One living page per project. Agents update it in place; `brain heal` keeps it honest.
> Rule of truth: **code wins**. If anything here conflicts with the code, the code is right.

## What this is

gitbrain is a CLI that gives AI coding agents self-healing project memory. Agents write
plain-markdown memory into `.brain/` (context, decisions, handoff, observations); a scheduled
`brain heal` diffs git history and repairs that memory so it never drifts from the code.
It is built for anyone running Claude Code, Codex, Cursor, ZCode or similar on real repos.

## Architecture map

- `src/cli.ts` — commander entrypoint; all printing and exit codes live here, nowhere else.
- `src/commands/init.ts` — `runInit(dir)`: scaffolds `.brain/`, refuses to overwrite.
- `src/commands/status.ts` — `runStatus(dir)` + `readLedger(dir)`: ledger summary.
- `src/brain.ts` — the contract: file names, `brainDir()`, `Ledger`/`LedgerEntry` types.
- `src/templates.ts` — initial `.brain/*.md` contents; doubles as the format spec.
- `src/version.ts` — `VERSION`, kept in sync with package.json by `test/version.test.ts`.
- `test/` — vitest; every test builds its own project in a tmpdir, nothing shared.
- `docs/logo.svg` — the logo used in the README.
- `src/git/exec.ts` — `git -C <repo> …` wrapper; friendly error when not a git repo.
- `src/git/diff.ts` — `collectChangeSet(dir, lastReconciledSha)` → commits, per-file stats, touched paths (merges ephemeral deletes from `git log` on first run).
- `src/brain/parse.ts` — parse DECISIONS/OBSERVATIONS/CONTEXT paths; reconcile markdown ↔ `brain.json`.
- `src/heal/detect.ts` — `detectDrift` → `DriftReport` (close/supersede/re-point proposals, no writes).
- `src/heal/apply.ts` — `applyDriftReport` writes inside `.brain/` only (ledger, annotations, reports, SHA).
- `src/commands/heal.ts` — `runHeal`: collect → detect → apply; optional `commitBrainMemory`; `formatHealHumanOutput` / `healResultToJson`.
- `src/brain/lint.ts` — `lintBrain`: markdown ↔ ledger validation (duplicates, sequence, required fields).
- `src/commands/lint.ts` — `runLint`, human/JSON formatters; non-zero exit when issues exist.
- `src/git/commit-brain.ts` — `commitBrainMemory`: stage only heal-written `.brain/` paths, conventional commit (never pushes).
- `src/agents/instruction.ts` — canonical paste-ready instruction body + HTML comment markers.
- `src/agents/emit.ts` — `emitAgentInstructions` / `parseAgentToolsList` for `brain init --agents`.
- `examples/github-action/heal.yml` — copy-paste workflow: scheduled `brain heal` + PR on drift.
- `examples/demo-project/` — scripted drift story with before/after snapshots and `build-history.sh`.
- `docs/scheduling.md` — cron, launchd, and CI scheduling notes.

## Conventions

- Strict TypeScript, ESM, `verbatimModuleSyntax`; imports of local modules use `.js` suffixes.
- Command modules are pure: take a directory, return plain objects, throw `Error` with a
  friendly message. No `console.*` outside `src/cli.ts`.
- `npm run check` (tsc --noEmit + vitest) must pass before every commit. Prettier formats everything.
- Conventional commits. Never `git add .`. Never push from an automated run.
- One roadmap unit per build run; the protocol is in `ROADMAP.md`.

## Current focus

**0.2.0** ships `brain heal` end-to-end. **v0.5** adds lint, agent emitters, scheduling, `examples/demo-project/`, and `scripts/demo.sh` (transcript + optional VHS). Next: `brain ask` (v0.6).

_Created 2026-10-21 by `brain init`._
