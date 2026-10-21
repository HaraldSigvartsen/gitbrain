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
- Planned: `src/git/` (read-only git access via `execFile`) and `src/heal/` (detect + apply).

## Conventions

- Strict TypeScript, ESM, `verbatimModuleSyntax`; imports of local modules use `.js` suffixes.
- Command modules are pure: take a directory, return plain objects, throw `Error` with a
  friendly message. No `console.*` outside `src/cli.ts`.
- `npm run check` (tsc --noEmit + vitest) must pass before every commit. Prettier formats everything.
- Conventional commits. Never `git add .`. Never push from an automated run.
- One roadmap unit per build run; the protocol is in `ROADMAP.md`.

## Current focus

v0.1 (Phase 0) is complete. Next unit is v0.2: the git diff collector in `src/git/diff.ts`.
`brain heal` does not exist yet — the README describes its planned behaviour and says so.

_Created 2026-10-21 by `brain init`._
