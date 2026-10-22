/**
 * Paste-ready gitbrain session instructions (see docs/agents.md).
 * Kept in one module so `brain init --agents` and docs stay aligned.
 */
export const GITBRAIN_INSTRUCTION_BODY = `This project uses gitbrain memory.

Before starting work, read \`.brain/CONTEXT.md\` and \`.brain/HANDOFF.md\`.

At the end of every session:

1. Update \`.brain/CONTEXT.md\` sections you learned something about — edit them
   in place; do not append duplicate sections.
2. Add significant choices to \`.brain/DECISIONS.md\` as a new \`## D-<next> —
   <title>\` entry (Status: active) at the top of the log, and register the same
   id/title/status in \`.brain/brain.json\`.
3. Add noticed-but-deliberately-unfixed problems to \`.brain/OBSERVATIONS.md\` as a
   new \`## O-<next> — <title>\` entry with a \`Where:\` path pointing at the code.
4. Replace \`.brain/HANDOFF.md\` with the current handoff: what was done, where
   things stopped, next steps. Keep it under a screenful.

Entry ids are sequential (D-0001, D-0002, … / O-0001, O-0002, …), newest at the
top, never renumbered, never reused — supersede instead of deleting.

If memory conflicts with the code, the code wins; say so in the session summary
so the drift gets healed or recorded.`;

export const GITBRAIN_MARKER_BEGIN = "<!-- gitbrain:instructions:begin -->";
export const GITBRAIN_MARKER_END = "<!-- gitbrain:instructions:end -->";
