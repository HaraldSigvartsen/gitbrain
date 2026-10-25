# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Local pre-push gate: `npm run gate` runs `npm run check` (typecheck + vitest). `npm install` sets `core.hooksPath` to `.githooks` so `git push` runs that gate before the remote sees the commits. No new GitHub Actions workflows.

## [0.3.0] - 2026-10-23

### Added

- `brain ask` — local, offline keyword retrieval over a project's `.brain/` (`--all` for sibling projects, `--json`)
- `brain lint` — markdown ↔ ledger validation (duplicate IDs, missing registrations, broken sequences; `--json`, non-zero exit on issues)
- `brain init --agents` — paste-ready instruction snippets for Claude Code, Codex, Cursor, ZCode/OpenCode and Copilot (`docs/agents.md`)
- `brain heal --summarize` and `brain ask --summarize` — optional OpenAI-compatible LLM summary (env-configured API key; off by default)
- Scheduling recipes: GitHub Action that opens a PR on drift (`examples/github-action/heal.yml`) plus cron/launchd notes (`docs/scheduling.md`)
- `examples/demo-project/` walkthrough, `scripts/demo.sh` terminal demo (`--vhs` GIF recording), README demo GIF and social preview
- Cross-platform support: posix-normalised repo paths; CI on ubuntu/macos/windows × Node 20 and 22

### Fixed

- `brain heal` no longer flags bare brain-file names (`brain.json`, `CONTEXT.md`) as stale — they resolve inside `.brain/` (O-0001)
- Recorded SHAs are hex-validated before reaching git's argv (option-injection guard); same-directory rename line counts no longer read as 0/0 (numstat parsed in `-z` form)

## [0.2.0] - 2026-10-22

### Added

- `brain heal [dir]` — reconcile `.brain/` against git history (`--dry-run`, `--json`, `--commit`)
- Git change-set collector (`src/git/diff.ts`), brain parser, drift detector, and heal apply path
- Rename-aware re-pointing for observations and CONTEXT.md paths
- Install-from-GitHub path verified via `npm pack` integration test
- `docs/cli.md` — global flags (`--quiet`, `--color`) and exit codes
- TTY-aware ANSI colours for human-readable command output
- `brain heal --since <ref|date>` to bound reconciliation; first-run cap uses `rev-list -n` (no full history walk)

### Changed

- README documents real `brain heal` output and current roadmap status

## [0.1.0] - 2026-10-21

### Added

- `brain init` and `brain status`
- `.brain/` templates, ledger (`brain.json`), CI, and project documentation

[0.2.0]: https://github.com/HaraldSigvartsen/gitbrain/compare/c80ebcf...main
[0.1.0]: https://github.com/HaraldSigvartsen/gitbrain/commit/c80ebcf
