# gitbrain — session handoff

> The warm start for the next session. Overwrite it at the end of every session and
> keep it under a screenful. Detail belongs in CONTEXT.md or DECISIONS.md.

- **Date:** 2026-10-21
- **What we did:** Phase 0 scaffold, interactively: strict TS/ESM project, `brain init`
  and `brain status` with 9 passing tests, README/ARCHITECTURE/ROADMAP/CONTRIBUTING,
  logo, CI workflow, MIT license. Adopted `.brain/` in this repo. Published to GitHub.
- **Where we stopped:** v0.1 complete and green (`npm run check`, `npm audit` clean).
  No `src/git/` or `src/heal/` code exists yet.
- **Next steps:** v0.2 unit 1 — `src/git/diff.ts` change-set collector. Read the
  acceptance criteria in `ROADMAP.md`; use `execFile("git", [...])` only, never a
  shell string; build fixture repos in tmpdirs inside the tests.
- **Open threads:** README's `brain heal` section is a design sketch, not a demo of
  working code — keep it honest as the implementation lands. The `prepare` script runs
  `tsc` on every local `npm install`; acceptable for now, revisit if it annoys contributors.
