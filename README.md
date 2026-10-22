<div align="center">

<img src="docs/logo.svg" width="140" alt="gitbrain logo" />

# gitbrain

**Self-healing project memory for AI coding agents.**

Agents write it. Git proves it. A scheduled reconciler keeps it true.

[![CI](https://github.com/HaraldSigvartsen/gitbrain/actions/workflows/ci.yml/badge.svg)](https://github.com/HaraldSigvartsen/gitbrain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-blue.svg)](https://nodejs.org)
[![built by a scheduled agent](https://img.shields.io/badge/built%20by-a%20scheduled%20agent-8b5cf6.svg)](ROADMAP.md)

[Why](#why) · [Quick start](#quick-start) · [The .brain format](#the-brain-format) · [How healing works](#how-healing-works) · [Tell your agents](#tell-your-agents) · [Comparison](#compared-to-existing-tools)

</div>

---

## Why

File-based project memory for coding agents — a living context page, a decision log, a session handoff — became a popular pattern because it works: a fresh session starts warm instead of re-reading your whole repo.

Then it rots.

A decision gets reversed. A file gets renamed. A directory you documented last month is deleted today. Six weeks later your agent confidently cites an architecture that no longer exists — because **every memory tool available today is write-only**. The agent writes memory during sessions; nothing ever checks the memory against the code afterwards.

gitbrain closes that loop:

> Agents write memory as plain markdown in `.brain/`.
> A scheduled `brain heal` diffs git history and **repairs the memory** — closing decisions the code has overruled, flagging stale context, committing a reviewable drift report.

Plain files, any agent tool, git as the source of truth. No server, no cloud, no lock-in.

## Quick start

```bash
# Requires Node >= 20
npm install -g github:HaraldSigvartsen/gitbrain

cd your-project
brain init
brain status
brain heal --dry-run   # preview drift; run `brain heal` on a schedule (or `brain heal --commit`)
```

Commit the `.brain/` directory — memory is meant to be shared, diffed and reviewed like code. (Publishing to the npm registry as `@haraldsigvartsen/gitbrain` is on the [roadmap](ROADMAP.md); installing from GitHub works today.)

## The `.brain` format

```
your-project/
└── .brain/
    ├── CONTEXT.md        # living project context — the "what and why"
    ├── DECISIONS.md      # decision log; entries carry stable IDs
    ├── HANDOFF.md        # latest session handoff — the warm start
    ├── OBSERVATIONS.md   # "things I noticed" backlog, prioritised
    ├── brain.json        # machine ledger: IDs, statuses, last healed SHA
    └── reports/          # (created by heal) dated memory drift reports
```

A decision entry looks like:

```markdown
## D-0007 — Sessions in Durable Objects, not KV

- **Date:** 2026-10-21
- **Status:** active
- **Context:** checkout sessions need strong consistency across requests
- **Choice:** Durable Objects; rejected KV (eventual consistency)
- **Consequences:** per-object billing; session code must live in one class
```

An observation entry looks like:

```markdown
## O-0004 — Race in checkout queue consumer

- **Priority:** CRITICAL
- **Status:** open
- **Where:** `src/checkout/queue.ts`
- **Found:** 2026-10-21
- **Detail:** Duplicate delivery when two consumers ack the same batch
```

The IDs are the trick. Because every entry is addressable and every observation points at a path in your repo, the reconciler can reason about them mechanically.

## How healing works

`brain heal` runs on a schedule (or after big refactors) and does four things. Example output from a small fixture repo where an observation still pointed at a deleted file:

```
$ brain heal
Reconciling .brain against git since repo start (2 commits)…

  ✓ O-0001  "Race in checkout queue"                → closed
            src/checkout/queue.ts was deleted in the reconciled range

Wrote memory drift report → .brain/reports/2026-10-22.md
```

Flags: `--dry-run` (print the report, write nothing), `--json` (machine-readable), `--commit` (commit only `.brain/` changes locally — never pushes).

1. **Collect** — a structured change set from `git log` / `git diff` since the last reconciled SHA (first run: capped whole-history summary).
2. **Detect** — match ledger entries and CONTEXT.md path references against the change set. Deleted/heavily-rewritten code that an observation points at makes it a close candidate; replaced decision subject code makes it a supersede candidate; renames can re-point `Where:` paths. Conservative by default: propose, don't silently rewrite.
3. **Apply** — update ledger statuses, annotate entries in the markdown (original text is kept, a `> healed <date> — <reason>` line is added), write a dated drift report.
4. **Record** — advance `last_reconciled_sha`. Idempotent: running twice changes nothing the second time.

Every change lands as a reviewable git commit. Your memory's edit history _is_ its audit trail.

## Tell your agents

Paste this into whatever instructions your agents already read (CLAUDE.md, AGENTS.md, cursor rules, system prompt — the format is tool-agnostic):

```markdown
This project uses gitbrain memory. Read `.brain/CONTEXT.md` and
`.brain/HANDOFF.md` before starting work. At the end of every session:

1. Update `.brain/CONTEXT.md` sections you learned something about — edit in
   place, don't append duplicate sections.
2. Add significant choices to `.brain/DECISIONS.md` as `## D-<next> — title`
   (Status: active) and register the entry in `.brain/brain.json`.
3. Replace `.brain/HANDOFF.md` with the current handoff (keep it under a screen).
4. Add noticed-but-unfixed problems to `.brain/OBSERVATIONS.md` as
   `## O-<next> — title` with a `Where:` path.

IDs are sequential and never reused. If memory conflicts with code,
the code wins — say so in your session summary.
```

Per-tool paste locations (Claude Code, Codex, Cursor, ZCode, OpenCode, Copilot), an
optional `brain lint` session-end hook, and a worked example: [docs/agents.md](docs/agents.md).

## Compared to existing tools

|                                     | File-based (git-diffable) | Any agent tool | Grounded in git history | **Repairs stale memory** | Reviewable changes |
| ----------------------------------- | :-----------------------: | :------------: | :---------------------: | :----------------------: | :----------------: |
| Cline-style Memory Banks            |             ✓             |       ✗        |            ✗            |            ✗             |        n/a         |
| Memory MCP servers (mem0 & friends) |     ✗ (vector store)      |       ~        |            ✗            |            ✗             |         ✗          |
| Markdown handoff scaffolds          |             ✓             |       ~        |            ✗            |            ✗             |         ✓          |
| **gitbrain**                        |             ✓             |       ✓        |            ✓            |            ✓             |         ✓          |

The existing approaches all store memory. None of them _check it_. That's the wedge.

## This repo maintains itself

gitbrain is built in public by a scheduled AI agent — one roadmap unit per run, tests and typecheck gating every commit, with human review on push. The protocol it follows lives in [ROADMAP.md](ROADMAP.md), and the repo carries its own `.brain/` directory: **gitbrain uses gitbrain to remember gitbrain.** Watch the commit history to see it work.

## Roadmap

- **v0.2–v0.4** — shipped in **0.2.0**: git change-set collector, drift detector, `brain heal` (`--dry-run`, `--json`, `--commit`, idempotent)
- **v0.5** — agent emitter recipes + `brain lint` (format validation) + examples
- **v0.6** — `brain ask` (local, offline retrieval over one or many brains)
- **v0.7** — npm publish + launch (demo GIF, social preview)

Details and acceptance criteria per unit: [ROADMAP.md](ROADMAP.md).

## Contributing

Human PRs are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first units are the unchecked items in [ROADMAP.md](ROADMAP.md); one unit ≈ one PR.

## License

[MIT](LICENSE) © Harald Sigvartsen
