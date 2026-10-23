# CLI reference

Global flags apply before any subcommand:

```bash
brain --quiet heal --dry-run .
brain --no-color status
```

| Flag | Description |
| ---- | ----------- |
| `-q`, `--quiet` | Suppress routine stdout (human-readable summaries). Errors still print to stderr. `--json` always emits JSON on stdout. |
| `--color` | Force ANSI colours even when stdout is not a TTY. |
| `--no-color` | Disable ANSI colours (also honoured when the `NO_COLOR` environment variable is set). |

Colours are used only for human-readable output on an interactive terminal. Piped or redirected stdout stays plain unless `--color` is set.

Repo-relative paths in `.brain/` markdown and heal drift reports always use forward slashes (`src/foo.ts`), including on Windows.

## Exit codes

| Code | When |
| ---- | ---- |
| `0` | Success. |
| `1` | Failure: missing `.brain/`, invalid flags, lint errors, `brain ask` with no matches, or any other thrown error. |

Commands that write JSON (`--json`) still use these codes; parse stdout only when the exit code is `0` (except `brain lint --json`, which prints a JSON body on failure too).

## Commands

| Command | Notes |
| ------- | ----- |
| `brain init` | Creates `.brain/`; refuses when memory already exists (use `--agents` to refresh snippets only). |
| `brain status` | Read-only ledger summary. |
| `brain heal` | Reconciles memory; `--dry-run` previews; `--commit` commits only `.brain/` changes locally; `--since <ref\|date>` limits history (first run still capped at 500 commits unless the window is smaller). Optional `--summarize` calls an OpenAI-compatible chat API (off by default; needs `GITBRAIN_LLM_API_KEY` or `OPENAI_API_KEY`; optional `GITBRAIN_LLM_BASE_URL`, `GITBRAIN_LLM_MODEL`). |
| `brain lint` | Validates markdown ↔ `brain.json`; exits `1` when issues are found. |
| `brain ask` | Offline keyword search; exits `1` when there are no hits. Optional `--summarize` uses the same LLM env vars to turn hits into a short answer. |

Agent setup and scheduling: [agents.md](agents.md), [scheduling.md](scheduling.md).
