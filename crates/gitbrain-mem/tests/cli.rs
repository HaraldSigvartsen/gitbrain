use std::io::Write;
use std::process::{Command, Stdio};

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_gitbrain-mem"))
}

#[test]
fn cli_add_search_wings() {
    let tmp = tempfile::tempdir().unwrap();
    let pal = tmp.path().to_str().unwrap();
    let out = bin()
        .args([
            "--palace",
            pal,
            "add",
            "--wing",
            "gitbrain",
            "--room",
            "handoff",
            "ship the rust engine",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let mut child = bin()
        .args([
            "--palace", pal, "add", "--wing", "gitbrain", "--room", "handoff",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"from stdin: engine benchmarks")
        .unwrap();
    assert!(child.wait_with_output().unwrap().status.success());

    let out = bin()
        .args(["--palace", pal, "search", "engine", "--json"])
        .output()
        .unwrap();
    let hits: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(hits.as_array().unwrap().len(), 2);

    let out = bin().args(["--palace", pal, "wings"]).output().unwrap();
    let s = String::from_utf8(out.stdout).unwrap();
    assert!(s.contains("gitbrain (2)"), "{s}");
    assert!(s.contains("handoff (2)"), "{s}");
}

#[test]
fn cli_serve_speaks_mcp() {
    let tmp = tempfile::tempdir().unwrap();
    let mut child = bin()
        .args(["--palace", tmp.path().to_str().unwrap(), "serve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2025-06-18"}}}}"#).unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}"#).unwrap();
    }
    let out = child.wait_with_output().unwrap();
    let s = String::from_utf8(out.stdout).unwrap();
    assert_eq!(s.lines().count(), 2);
    assert!(s.contains("memory_search"));
}
