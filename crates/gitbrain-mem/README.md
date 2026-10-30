# gitbrain-mem (experimental)

Local shared memory for AI agents, written in Rust. One palace on disk, one MCP
server, every agent (Claude Code, Cursor, Codex, OpenCode, …) reads and writes
the same memory. No cloud, no API keys, no LLM calls.

Memory is organised as a palace:

| Level  | What it is                                  | Example                         |
| ------ | ------------------------------------------- | ------------------------------- |
| wing   | a person, agent or project                  | `gitbrain`, `harald`, `codex`   |
| room   | a topic inside a wing                       | `decisions`, `handoff`, `diary` |
| drawer | one piece of original text, stored verbatim | a decision, a session summary   |

Search is BM25 full-text ([tantivy](https://github.com/quickwit-oss/tantivy)),
optionally scoped to a wing or room. Accents fold (`Ålesund` matches `alesund`).

## Build

```bash
cargo build --release --manifest-path crates/gitbrain-mem/Cargo.toml
# binary: crates/gitbrain-mem/target/release/gitbrain-mem
```

## CLI

```bash
gitbrain-mem add --wing gitbrain --room decisions "Use tantivy for BM25; embeddings later."
echo "long text from stdin" | gitbrain-mem add --wing harald --room diary --source session:42
gitbrain-mem search "why tantivy" --wing gitbrain -n 5
gitbrain-mem search "why tantivy" --json
gitbrain-mem wings
```

The palace lives in `~/.gitbrain/palace`. Override with `--palace DIR` or
`GITBRAIN_MEM_DIR`.

## MCP server

`gitbrain-mem serve` speaks MCP over stdio. Tools:

| Tool                | Arguments                                 |
| ------------------- | ----------------------------------------- |
| `memory_add`        | `wing`, `room`, `text`, optional `source` |
| `memory_search`     | `query`, optional `wing`, `room`, `limit` |
| `memory_list_wings` | none                                      |
| `memory_get`        | `id`                                      |

Claude Code:

```bash
claude mcp add --scope user gitbrain-mem -- /path/to/gitbrain-mem serve
```

Cursor (`~/.cursor/mcp.json`) and other JSON-configured clients:

```json
{
  "mcpServers": {
    "gitbrain-mem": { "command": "/path/to/gitbrain-mem", "args": ["serve"] }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.gitbrain-mem]
command = "/path/to/gitbrain-mem"
args = ["serve"]
```

Several agents can run their own `serve` process against the same palace at the
same time. Writes take a short file lock; readers pick up other processes'
writes on the next query.

## Tests

```bash
cargo test --manifest-path crates/gitbrain-mem/Cargo.toml
cargo run --release --manifest-path crates/gitbrain-mem/Cargo.toml --example bench -- 10000
```

`npm run gate` runs the Rust tests too when `cargo` is on `PATH`
(`GITBRAIN_SKIP_RUST=1` skips them).
