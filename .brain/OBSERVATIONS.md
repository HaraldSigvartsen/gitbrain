# gitbrain — observations ("things I noticed")

> Problems spotted but deliberately not fixed in the session that found them.
> Priorities: CRITICAL · IMPORTANT · OPPORTUNITY · MINOR.
> The reconciler auto-closes entries whose code no longer exists as described.

Entry format (new entries go at the top, right below this header):

    ## O-0001 — <short, searchable title>
    - **Priority:** MINOR            <!-- CRITICAL | IMPORTANT | OPPORTUNITY | MINOR -->
    - **Status:** open               <!-- open | fixed | wontfix -->
    - **Where:** `path/to/file.ts`   <!-- the reconciler watches this path -->
    - **Found:** <yyyy-mm-dd>
    - **Detail:** <what was noticed, and why it matters>

IDs are sequential (O-0001, O-0002, …) and are never reused.

---

## O-0001 — Bare brain-file names flagged as stale (false positive)
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** `src/heal/detect.ts`
- **Found:** 2026-10-22
- **Detail:** `brain heal --dry-run` on this repo flagged CONTEXT.md's mention of
  `brain.json` as "not present at HEAD" — the existence check resolves the bare name
  against the repo root, but the file lives at `.brain/brain.json`. Brain-relative
  mentions (brain.json, CONTEXT.md, DECISIONS.md, …) should resolve inside `.brain/`
  before being called stale.

_(no observations recorded yet — created 2026-10-21 by `brain init`)_
