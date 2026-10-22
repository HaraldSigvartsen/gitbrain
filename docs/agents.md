# Agent recipes for gitbrain

How to point each coding-agent tool at a project's `.brain/` memory. The format is
plain files — every tool that can read a repo can use it. No MCP server required.

## The instruction block

Paste this wherever your tool reads project instructions:

```markdown
This project uses gitbrain memory.

Before starting work, read `.brain/CONTEXT.md` and `.brain/HANDOFF.md`.

At the end of every session:

1. Update `.brain/CONTEXT.md` sections you learned something about — edit them
   in place; do not append duplicate sections.
2. Add significant choices to `.brain/DECISIONS.md` as a new `## D-<next> —
   <title>` entry (Status: active) at the top of the log, and register the same
   id/title/status in `.brain/brain.json`.
3. Add noticed-but-deliberately-unfixed problems to `.brain/OBSERVATIONS.md` as a
   new `## O-<next> — <title>` entry with a `Where:` path pointing at the code.
4. Replace `.brain/HANDOFF.md` with the current handoff: what was done, where
   things stopped, next steps. Keep it under a screenful.

Entry ids are sequential (D-0001, D-0002, … / O-0001, O-0002, …), newest at the
top, never renumbered, never reused — supersede instead of deleting.

If memory conflicts with the code, the code wins; say so in the session summary
so the drift gets healed or recorded.
```

## Where to paste it

| Tool | File | Notes |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | Commit it so the whole team shares one brain. |
| Codex CLI | `AGENTS.md` | |
| ZCode | `AGENTS.md` | |
| OpenCode | `AGENTS.md` | |
| Cursor | `.cursor/rules/gitbrain.mdc` | Frontmatter: `description: gitbrain memory` + `alwaysApply: true`. Legacy projects use `.cursorrules`. |
| GitHub Copilot coding agent | `.github/copilot-instructions.md` | |
| Anything else | system prompt / custom instructions | The block is tool-agnostic. |

## Validate at session end: `brain lint`

`brain lint` checks that the markdown entries and `brain.json` agree — duplicate
ids, missing registrations, broken sequences. Only commit a brain that passes:

```bash
brain lint .
```

If your tool supports lifecycle hooks, run it automatically. Claude Code example
(`.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "brain lint ." }] }]
  }
}
```

For tools without hooks, the discipline is the same: lint before you commit
`.brain/` changes.

## A worked session

Before (HANDOFF.md from the previous session):

```markdown
- **Date:** 2026-10-20
- **What we did:** wired the checkout queue consumer
- **Where we stopped:** consumer deployed, ack logic untested
- **Next steps:** load-test duplicate delivery
- **Open threads:** none
```

After one session, the agent: updated `CONTEXT.md`'s architecture map with the new
queue, added `D-0012 — at-least-once delivery with idempotent acks` to
DECISIONS.md (and `brain.json`), filed `O-0005 — ack race under duplicate
delivery` against `src/checkout/queue.ts`, and rewrote HANDOFF.md. Six weeks
later, when `queue.ts` is refactored away, `brain heal` closes `O-0005` on its
own — that entry no longer describes code that exists.
