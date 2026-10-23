# Roadmap

Planned units per version. Each unchecked unit is roughly PR-sized and lists
its acceptance criteria; pick the first unchecked unit to keep version order.
See CONTRIBUTING.md for how to work on one.

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

- [x] `src/heal/detect.ts`: pure function — change set + `.brain/` contents → `DriftReport`
      (no file writes): observation whose `Where:` path was deleted/heavily rewritten →
      close candidate; decision whose subject code was replaced → supersede candidate;
      CONTEXT.md paths that no longer exist → stale flags. Conservative: propose, don't decide.
- [x] Markdown parsing of DECISIONS.md / OBSERVATIONS.md entries (IDs, statuses, `Where:` paths)
      and reconciliation with `brain.json` (mismatch → lint warning in the report)
- [x] Tests: fixture brains × fixture repos covering delete / rename / rewrite / healthy cases

## v0.4 — `brain heal`

- [x] `src/heal/apply.ts`: apply a DriftReport — update ledger, annotate entries in the
      markdown with a `> healed <date> — <reason>` line (original text kept), write
      `.brain/reports/<date>.md`, advance `last_reconciled_sha`
- [x] `brain heal [dir]` command with `--dry-run` (print the report, write nothing)
- [x] Idempotency tests: heal → heal again → zero changes the second time
- [x] `brain heal --commit`: optionally commit only `.brain/` changes with a conventional
      message (never stages or commits other files, never pushes)
- [x] Global install path: `npm pack` tarball installs with a working `brain` bin (`--version`,
      `init`, `heal --dry-run`); `dist/` shipped in the package so install works when lifecycle
      scripts are skipped

## v0.5 — agent emitters & validation

- [x] `docs/agents.md`: paste-ready session instructions for Claude Code, Codex, Cursor,
      ZCode, OpenCode; plus optional post-session hook scripts
- [x] `brain lint`: validate markdown entries ↔ ledger consistency (duplicate IDs,
      missing registrations, broken sequence)
- [x] `brain init --agents`: marker-delimited snippets for Cursor, Codex, Claude (and
      ZCode/OpenCode via `AGENTS.md`); idempotent re-run updates without duplicating
- [x] Scheduling recipes: `examples/github-action/heal.yml` (opens a PR on drift) and
      `docs/scheduling.md` (cron + launchd one-liners)
- [x] `examples/`: a small fake project with a brain, before and after heal
- [x] `scripts/demo.sh`: reproducible terminal demo (committed transcript; optional VHS GIF via `--vhs`)

## v0.6 — `brain ask` (local, offline)

- [x] Deterministic retrieval over `.brain/` of the current project; `--all` to search
      sibling projects' brains
- [ ] LLM summarisation strictly optional (user-configured key, off by default)

## v0.7 — launch

- [x] CLI UX: ANSI colours on TTY only (`--color` / `--no-color` / `NO_COLOR`), global
      `--quiet`, exit codes documented in `docs/cli.md` (`brain ask` exits `1` when there
      are no hits; `brain lint` on validation errors)
- [x] Large histories: first-run commit cap without full `rev-list`, `brain heal --since`
      (commit ref or ISO date), 1k-commit fixture test
- [x] Windows: posix-normalised repo paths in git change sets and heal reports; CI matrix
      (ubuntu, macos, windows × Node 20 and 22)
- [ ] npm publish as `@haraldsigvartsen/gitbrain` (check whether the bare `gitbrain`
      name became available / request transfer)
- [ ] README: real demo GIF (replace the ASCII sketch), social preview image
