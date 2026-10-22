# gitbrain — session handoff

> The warm start for the next session. Overwrite it at the end of every session and
> keep it under a screenful. Detail belongs in CONTEXT.md or DECISIONS.md.

- **Date:** 2026-10-22
- **What we did:** `src/brain/parse.ts` — parse decision/observation entries (ID, title, status, Where, priority), CONTEXT backtick paths, `reconcileLedger` mismatches; `test/brain-parse.test.ts` (25 tests total in suite).
- **Where we stopped:** ROADMAP v0.3 markdown-parsing checkbox ticked. `npm run check` + `npm run build` green.
- **Next steps:** `src/heal/detect.ts` — change set + parsed brain → `DriftReport` (fixture tests).
- **Open threads:** README `brain heal` section still a sketch until v0.4 CLI lands.
