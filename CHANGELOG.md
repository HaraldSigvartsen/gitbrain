# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-22

### Added

- `brain heal [dir]` — reconcile `.brain/` against git history (`--dry-run`, `--json`, `--commit`)
- Git change-set collector (`src/git/diff.ts`), brain parser, drift detector, and heal apply path
- Rename-aware re-pointing for observations and CONTEXT.md paths
- Install-from-GitHub path verified via `npm pack` integration test

### Changed

- README documents real `brain heal` output and current roadmap status

## [0.1.0] - 2026-10-21

### Added

- `brain init` and `brain status`
- `.brain/` templates, ledger (`brain.json`), CI, and project documentation

[0.2.0]: https://github.com/HaraldSigvartsen/gitbrain/compare/c80ebcf...main
[0.1.0]: https://github.com/HaraldSigvartsen/gitbrain/commit/c80ebcf
