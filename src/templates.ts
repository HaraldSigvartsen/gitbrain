/**
 * Initial contents of the `.brain/` markdown files.
 *
 * These templates double as the format specification: the entry shapes shown
 * here are what agents are asked to write and what `brain heal` parses.
 */

export function contextTemplate(project: string, date: string): string {
  return `# ${project} — project context

> One living page per project. Agents update it in place; \`brain heal\` keeps it honest.
> Rule of truth: **code wins**. If anything here conflicts with the code, the code is right.

## What this is

(_Two or three sentences: what this project does and for whom._)

## Architecture map

(_Key directories and what lives where. Keep it under ~20 lines.
File paths mentioned here are checked by the reconciler — dead paths get flagged._)

## Conventions

(_Naming, commit style and testing rules that a fresh session must know._)

## Current focus

(_What is being worked on right now. Refreshed at handoff time._)

_Created ${date} by \`brain init\`._
`;
}

export function decisionsTemplate(project: string, date: string): string {
  return `# ${project} — decision log

> Decisions a future session (or a future you) must not unknowingly reverse.
> Never delete entries — supersede them. The reconciler closes entries the code has overruled.

Entry format (new entries go at the top, right below this header):

    ## D-0001 — <short, searchable title>
    - **Date:** <yyyy-mm-dd>
    - **Status:** active            <!-- active | superseded | closed -->
    - **Context:** <the problem and the forces at play>
    - **Choice:** <what we chose, and what we rejected>
    - **Consequences:** <what this implies and what it rules out>

IDs are sequential (D-0001, D-0002, …) and are never reused.

---

_(no decisions recorded yet — created ${date} by \`brain init\`)_
`;
}

export function handoffTemplate(project: string, date: string): string {
  return `# ${project} — session handoff

> The warm start for the next session. Overwrite it at the end of every session and
> keep it under a screenful. Detail belongs in CONTEXT.md or DECISIONS.md.

- **Date:** —
- **What we did:** —
- **Where we stopped:** —
- **Next steps:** —
- **Open threads:** —

_(created ${date} by \`brain init\`)_
`;
}

export function observationsTemplate(project: string, date: string): string {
  return `# ${project} — observations ("things I noticed")

> Problems spotted but deliberately not fixed in the session that found them.
> Priorities: CRITICAL · IMPORTANT · OPPORTUNITY · MINOR.
> The reconciler auto-closes entries whose code no longer exists as described.

Entry format (new entries go at the top, right below this header):

    ## O-0001 — <short, searchable title>
    - **Priority:** MINOR            <!-- CRITICAL | IMPORTANT | OPPORTUNITY | MINOR -->
    - **Status:** open               <!-- open | fixed | wontfix -->
    - **Where:** \`path/to/file.ts\`   <!-- the reconciler watches this path -->
    - **Found:** <yyyy-mm-dd>
    - **Detail:** <what was noticed, and why it matters>

IDs are sequential (O-0001, O-0002, …) and are never reused.

---

_(no observations recorded yet — created ${date} by \`brain init\`)_
`;
}
