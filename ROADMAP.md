# Roadmap & build runbook

This repo is built in public by a scheduled AI agent — one unit of work per run —
on top of a Phase 0 scaffold written interactively with human review. Every run
follows the protocol below. Humans review and push.

## Protocol for every build run

1. Read `ROADMAP.md` and `ARCHITECTURE.md` before touching code. Also read this
   repo's own `.brain/CONTEXT.md` and `.brain/HANDOFF.md` — that is the project memory.
2. Pick the **first unchecked, unblocked** unit below. Implement exactly one unit.
3. TypeScript, matching the existing module layout and style; add or extend vitest
   tests covering all new logic. Follow the design rules in `ARCHITECTURE.md`.
4. Quality gates, in order — all must pass before committing:
   - `npm install` (only if dependencies changed for this unit)
   - `npm run check` (typecheck + tests)
   - `git diff` review: no debug logging, no TODO-as-code, no secrets, no unrelated changes
5. Commit: `git add <explicit files>` — never `git add .` — with a conventional
   message (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
6. Tick the unit's checkbox in this file and include it in the same commit.
7. Update this repo's own `.brain/` (we dogfood): append decisions as `D-xxxx`
   entries per the format in `.brain/DECISIONS.md`, register them in
   `.brain/brain.json`, and refresh `.brain/HANDOFF.md` for the next run.
8. **Never push. Never amend history. If blocked** (needs a design decision or
   missing information): append a note under `## Blockers` below with exactly
   what is needed, commit only that note, and stop.
9. Never create personal AI config files (`AGENTS.md`, `CLAUDE.md`, `.claude/`,
   `.cursor/`) inside this repo, and never touch anything outside this repo.

## v0.1 ✅ — Phase 0 (interactive scaffold, human-reviewed)

- [x] Repo scaffold: package.json, tsconfig (strict), vitest, prettier, editorconfig, CI, MIT license
- [x] `brain init` — `.brain/` scaffolding with documented templates + `brain.json` ledger
- [x] `brain status` — ledger summary with file presence check
- [x] README / ARCHITECTURE / ROADMAP / CONTRIBUTING, logo
- [x] Dogfood: this repo carries and maintains its own `.brain/`

## v0.2 — git diff collector

- [x] `src/git/diff.ts`: collect a structured change set since `last_reconciled_sha`
      (or from the first commit on first run, capped) — `{ commits, files: { path,
    status, added, removed, previousPath? }, touchedPaths }`
- [x] Uses `git log`/`git diff --numstat --find-renames` via `execFile` only — no shell
      interpolation of repo-controlled strings; clear errors when the directory is not
      a git repo
- [x] Fixture repos built in tmpdirs by the tests (init, commit, rename, delete cases)

## v0.3 — drift detector

- [ ] `src/heal/detect.ts`: pure function — change set + `.brain/` contents → `DriftReport`
      (no file writes): observation whose `Where:` path was deleted/heavily rewritten →
      close candidate; decision whose subject code was replaced → supersede candidate;
      CONTEXT.md paths that no longer exist → stale flags. Conservative: propose, don't decide.
- [x] Markdown parsing of DECISIONS.md / OBSERVATIONS.md entries (IDs, statuses, `Where:` paths)
      and reconciliation with `brain.json` (mismatch → lint warning in the report)
- [ ] Tests: fixture brains × fixture repos covering delete / rename / rewrite / healthy cases

## v0.4 — `brain heal`

- [ ] `src/heal/apply.ts`: apply a DriftReport — update ledger, annotate entries in the
      markdown with a `> healed <date> — <reason>` line (original text kept), write
      `.brain/reports/<date>.md`, advance `last_reconciled_sha`
- [ ] `brain heal [dir]` command with `--dry-run` (print the report, write nothing)
- [ ] Idempotency tests: heal → heal again → zero changes the second time

## v0.5 — agent emitters & validation

- [ ] `docs/agents.md`: paste-ready session instructions for Claude Code, Codex, Cursor,
      ZCode, OpenCode; plus optional post-session hook scripts
- [ ] `brain lint`: validate markdown entries ↔ ledger consistency (duplicate IDs,
      missing registrations, broken sequence)
- [ ] `examples/`: a small fake project with a brain, before and after heal

## v0.6 — `brain ask` (local, offline)

- [ ] Deterministic retrieval over `.brain/` of the current project; `--all` to search
      sibling projects' brains
- [ ] LLM summarisation strictly optional (user-configured key, off by default)

## v0.7 — launch

- [ ] npm publish as `@haraldsigvartsen/gitbrain` (check whether the bare `gitbrain`
      name became available / request transfer)
- [ ] README: real demo GIF (replace the ASCII sketch), social preview image
- [ ] Launch drafts in `docs/launch/`: Show HN, r/ClaudeCode, r/cursor

## Blockers

_(none — a build run appends here when it cannot proceed, with what it needs)_
