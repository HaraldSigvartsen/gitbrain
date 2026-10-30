//! Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
//!
//! Implements `initialize`, `ping`, `tools/list` and `tools/call`. Logs go to
//! stderr only; stdout carries protocol messages.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::{NewDrawer, Palace, SearchOpts};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

pub fn tools() -> Value {
    json!([
        {
            "name": "memory_add",
            "description": "Store one piece of text verbatim in the shared memory palace. Use a wing per person, agent or project and a room per topic.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "wing": {"type": "string", "description": "Person, agent or project, e.g. \"gitbrain\" or \"harald\"."},
                    "room": {"type": "string", "description": "Topic inside the wing, e.g. \"decisions\" or \"diary\"."},
                    "text": {"type": "string", "description": "The original text to store, unedited."},
                    "source": {"type": "string", "description": "Optional origin: file path, URL, session id."}
                },
                "required": ["wing", "room", "text"]
            }
        },
        {
            "name": "memory_search",
            "description": "Full-text (BM25) search over stored memory. Returns the original text of the best-matching drawers.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "wing": {"type": "string", "description": "Only search this wing."},
                    "room": {"type": "string", "description": "Only search this room."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 10}
                },
                "required": ["query"]
            }
        },
        {
            "name": "memory_list_wings",
            "description": "List all wings with their rooms and drawer counts.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "memory_get",
            "description": "Fetch one drawer by id.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"]
            }
        }
    ])
}

fn str_arg(args: &Value, k: &str) -> Option<String> {
    args.get(k).and_then(Value::as_str).map(str::to_string)
}

fn call_tool(p: &Palace, name: &str, args: &Value) -> anyhow::Result<Value> {
    match name {
        "memory_add" => {
            let d = p.add(NewDrawer {
                wing: str_arg(args, "wing").unwrap_or_default(),
                room: str_arg(args, "room").unwrap_or_default(),
                text: str_arg(args, "text").unwrap_or_default(),
                source: str_arg(args, "source"),
            })?;
            Ok(serde_json::to_value(d)?)
        }
        "memory_search" => {
            let q = str_arg(args, "query").unwrap_or_default();
            let opts = SearchOpts {
                wing: str_arg(args, "wing"),
                room: str_arg(args, "room"),
                limit: args.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize,
            };
            Ok(serde_json::to_value(p.search(&q, &opts)?)?)
        }
        "memory_list_wings" => Ok(serde_json::to_value(p.list_wings()?)?),
        "memory_get" => {
            let id = str_arg(args, "id").unwrap_or_default();
            match p.get(&id)? {
                Some(d) => Ok(serde_json::to_value(d)?),
                None => anyhow::bail!("no drawer with id {id}"),
            }
        }
        other => anyhow::bail!("unknown tool: {other}"),
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn err(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// Handle one JSON-RPC message. Returns `None` for notifications.
pub fn handle(p: &Palace, line: &str) -> Option<Value> {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Some(err(Value::Null, -32700, "parse error")),
    };
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let id = id?; // notifications (no id) get no response
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = if SUPPORTED.contains(&asked) {
                asked
            } else {
                PROTOCOL_VERSION
            };
            ok(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {"name": "gitbrain-mem", "version": env!("CARGO_PKG_VERSION")},
                    "instructions": "Shared local memory for all agents. Search before you assume; store decisions, handoffs and facts verbatim with memory_add (wing = person/agent/project, room = topic)."
                }),
            )
        }
        "ping" => ok(id, json!({})),
        "tools/list" => ok(id, json!({"tools": tools()})),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call_tool(p, name, &args) {
                Ok(v) => ok(
                    id,
                    json!({
                        "content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}],
                        "structuredContent": {"result": v},
                        "isError": false
                    }),
                ),
                Err(e) => ok(
                    id,
                    json!({"content": [{"type": "text", "text": format!("error: {e:#}")}], "isError": true}),
                ),
            }
        }
        _ => err(id, -32601, "method not found"),
    })
}

/// Serve MCP on the given reader/writer until EOF.
pub fn serve(p: &Palace, input: impl BufRead, mut output: impl Write) -> anyhow::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some(resp) = handle(p, &line) {
            writeln!(output, "{resp}")?;
            output.flush()?;
        }
    }
    Ok(())
}
