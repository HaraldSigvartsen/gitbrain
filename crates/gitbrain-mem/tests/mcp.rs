use gitbrain_mem::{mcp, Palace};
use serde_json::{json, Value};

fn call(p: &Palace, msg: Value) -> Value {
    mcp::handle(p, &msg.to_string()).expect("response")
}

#[test]
fn initialize_and_list_tools() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}),
    );
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["serverInfo"]["name"], "gitbrain-mem");
    assert!(r["result"]["capabilities"]["tools"].is_object());

    assert!(mcp::handle(
        &p,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
    )
    .is_none());

    let r = call(&p, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    let names: Vec<&str> = r["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    for n in [
        "memory_add",
        "memory_search",
        "memory_list_wings",
        "memory_get",
    ] {
        assert!(names.contains(&n), "missing {n}");
    }
}

#[test]
fn add_search_and_list_via_tools() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_add","arguments":{"wing":"gitbrain","room":"decisions","text":"Rust engine uses tantivy for BM25"}}}),
    );
    assert_eq!(r["result"]["isError"], false);
    let id = r["result"]["structuredContent"]["result"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"tantivy","wing":"gitbrain"}}}),
    );
    let hits = r["result"]["structuredContent"]["result"]
        .as_array()
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["id"], id.as_str());
    assert_eq!(hits[0]["text"], "Rust engine uses tantivy for BM25");
    assert!(r["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("tantivy"));

    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_list_wings","arguments":{}}}),
    );
    assert_eq!(
        r["result"]["structuredContent"]["result"][0]["wing"],
        "gitbrain"
    );

    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_get","arguments":{"id":id}}}),
    );
    assert_eq!(r["result"]["isError"], false);
}

#[test]
fn errors_are_reported_not_fatal() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_add","arguments":{"wing":"","room":"r","text":"x"}}}),
    );
    assert_eq!(r["result"]["isError"], true);
    let r = call(
        &p,
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nope","arguments":{}}}),
    );
    assert_eq!(r["result"]["isError"], true);
    let r = call(&p, json!({"jsonrpc":"2.0","id":3,"method":"bogus"}));
    assert_eq!(r["error"]["code"], -32601);
    let r = mcp::handle(&p, "{not json").unwrap();
    assert_eq!(r["error"]["code"], -32700);
}

#[test]
fn serve_loop_over_stdio_streams() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let input = [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}).to_string(),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string(),
        String::new(),
        json!({"jsonrpc":"2.0","id":2,"method":"ping"}).to_string(),
    ]
    .join("\n");
    let mut out = Vec::new();
    mcp::serve(&p, input.as_bytes(), &mut out).unwrap();
    let lines: Vec<Value> = String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["id"], 2);
}
