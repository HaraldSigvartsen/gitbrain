# Architecture

## Modules

| Path                    | Responsibility                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`            | Commander entrypoint. Thin: parse arguments, print results, set exit codes.                                 |
| `src/commands/`         | One module per command. Pure logic that throws friendly errors — no `console.*` here, the CLI layer prints. |
| `src/brain.ts`          | The contract: `.brain/` file names, paths, and the `Ledger` types.                                          |
| `src/templates.ts`      | Initial `.brain/` file contents. These templates double as the format specification.                        |
| `src/git/` _(planned)_  | Read-only git access. Always shells out to the `git` binary — no git libraries.                             |
| `src/heal/` _(planned)_ | Drift detection and application. Never mutates anything outside `.brain/`, never touches git history.       |

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
3. **Boring technology.** Shells out to the `git` CLI. No database, no server, no cloud, no network. Works offline.
4. **Small dependency surface.** Every new runtime dependency needs a `D-xxxx` decision entry in this repo's own DECISIONS.md justifying it.
5. **Idempotency.** Every heal step must be safe to re-run; running twice changes nothing the second time.
6. **Safety.** `heal` only reads repo history and only writes inside `.brain/`. No secrets in memory files.
7. **Command logic is testable.** Commands take a directory and return plain objects; all printing lives in `src/cli.ts`.
