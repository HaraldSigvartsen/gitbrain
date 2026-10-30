# Architecture

## Modules

| Path                    | Responsibility                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`            | Commander entrypoint. Thin: parse arguments, print results, set exit codes.                                 |
| `src/commands/`         | One module per command. Pure logic that throws friendly errors — no `console.*` here, the CLI layer prints. |
| `src/brain.ts`          | The contract: `.brain/` file names, paths, and the `Ledger` types.                                          |
| `src/templates.ts`      | Initial `.brain/` file contents. These templates double as the format specification.                        |
| `src/git/`              | Git via `execFile("git", …)`. `diff.ts` collects change sets; `commit-brain.ts` optionally commits heal output (`.brain/` only). |
| `src/heal/`             | Drift detection (`detect.ts`) and application (`apply.ts`). Never mutates anything outside `.brain/`. |
| `src/llm/`              | Optional `--summarize` for `heal` / `ask` (OpenAI-compatible HTTP, env keys only). |
| `crates/gitbrain-mem/`  | Experimental Rust shared-memory engine: palace (wing/room/drawer), tantivy BM25, CLI and MCP stdio server. Separate from the npm package. |

## Data flow

```
agents write .brain/*.md            (any tool — it's just files)
        │
        ▼
brain.json ledger tracks entry IDs + statuses
        │
        ▼
brain heal ── git diff since last_reconciled_sha ──► structured change set
        │                                              (commits, per-file adds/removes,
        ▼                                               renames, touched paths)
drift detector ──► DriftReport (pure data, no writes)
        │
        ▼
apply: ledger statuses updated, entries annotated in markdown,
       .brain/reports/<date>.md written, last_reconciled_sha advanced
```

## Design rules

1. **Plain files.** UTF-8, LF, markdown for humans and agents, `brain.json` as the machine index. The markdown is the source of truth; the ledger must always be reconstructible from it.
2. **Code wins.** `brain heal` never invents context. It flags, annotates and closes based on evidence from git; when uncertain it proposes rather than decides.
3. **Boring technology.** Shells out to the `git` CLI. No database, no server. Default commands work offline; `--summarize` on `heal` / `ask` optionally calls a user-configured OpenAI-compatible HTTP API (native `fetch`, no extra runtime deps).
4. **Small dependency surface.** Every new runtime dependency needs a `D-xxxx` decision entry in this repo's own DECISIONS.md justifying it.
5. **Idempotency.** Every heal step must be safe to re-run; running twice changes nothing the second time.
6. **Safety.** `heal` only reads repo history and only writes inside `.brain/`. No secrets in memory files.
7. **Command logic is testable.** Commands take a directory and return plain objects; all printing lives in `src/cli.ts`.
