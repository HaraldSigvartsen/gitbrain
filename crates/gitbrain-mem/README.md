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

With the optional `embed` feature, every drawer also gets a local embedding
(multilingual-e5-small via [fastembed](https://github.com/Anush008/fastembed-rs),
384 dimensions, Norwegian and English work) and search becomes hybrid: BM25 and
vector results are fused with reciprocal rank fusion (k = 60) plus a small
recency boost. Still no API keys and no network after the first model download.

## Build

```bash
cargo build --release --manifest-path crates/gitbrain-mem/Cargo.toml
# binary: crates/gitbrain-mem/target/release/gitbrain-mem
```

### Hybrid search (`embed` feature)

```bash
cargo build --release --features embed --manifest-path crates/gitbrain-mem/Cargo.toml
```

- The model (~465 MB) is downloaded from Hugging Face on first use into
  `~/.gitbrain/models` (override with `GITBRAIN_MEM_MODEL_DIR`).
- `GITBRAIN_MEM_EMBED=0` turns embeddings off at runtime (BM25 only).
- Search modes: `auto` (default: hybrid if embeddings are on, else BM25),
  `bm25`, `vector`, `hybrid`.
- Drawers written by a BM25-only build have no vector; they are still found by
  the BM25 half of hybrid search. Palaces are compatible both ways.
- If embedding fails, the drawer is still stored (BM25 only) and a warning is
  printed on stderr.
- Linux: linking needs `libstdc++` (install `g++`).

## CLI

```bash
gitbrain-mem add --wing gitbrain --room decisions "Use tantivy for BM25; embeddings later."
echo "long text from stdin" | gitbrain-mem add --wing harald --room diary --source session:42
gitbrain-mem search "why tantivy" --wing gitbrain -n 5
gitbrain-mem search "why tantivy" --json
gitbrain-mem search "når skal bilen på service" --mode hybrid   # needs --features embed
gitbrain-mem wings
```

The palace lives in `~/.gitbrain/palace`. Override with `--palace DIR` or
`GITBRAIN_MEM_DIR`.

## MCP server

`gitbrain-mem serve` speaks MCP over stdio. Tools:

| Tool                | Arguments                                         |
| ------------------- | ------------------------------------------------- |
| `memory_add`        | `wing`, `room`, `text`, optional `source`         |
| `memory_search`     | `query`, optional `wing`, `room`, `limit`, `mode` |
| `memory_list_wings` | none                                              |
| `memory_get`        | `id`                                              |

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
cargo run --release --features embed --manifest-path crates/gitbrain-mem/Cargo.toml --example bench -- 10000 hybrid
# session-level recall on LongMemEval-S (download longmemeval_s_cleaned.json first)
cargo run --release --features embed --manifest-path crates/gitbrain-mem/Cargo.toml --example longmemeval -- longmemeval_s_cleaned.json 17
```

`npm run gate` runs the Rust tests too when `cargo` is on `PATH`
(`GITBRAIN_SKIP_RUST=1` skips them).
