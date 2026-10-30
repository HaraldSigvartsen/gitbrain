//! Micro-benchmark: `cargo run --release --example bench -- [N]`
//! Inserts N synthetic drawers in one batch, then times queries.

use std::time::Instant;

use gitbrain_mem::{NewDrawer, Palace, SearchOpts};

const WORDS: &[&str] = &[
    "agent",
    "memory",
    "decision",
    "deploy",
    "worker",
    "durable",
    "object",
    "stripe",
    "checkout",
    "session",
    "handoff",
    "rust",
    "tantivy",
    "index",
    "search",
    "latency",
    "pricing",
    "launch",
    "customer",
    "invoice",
    "kindergarten",
    "router",
    "mesh",
    "calendar",
    "meeting",
    "review",
    "merge",
    "branch",
    "test",
    "bug",
    "fix",
    "cache",
    "queue",
    "email",
    "domain",
    "dns",
    "sanity",
    "astro",
    "cloudflare",
    "posthog",
    "slack",
    "cursor",
    "codex",
    "claude",
    "opencode",
];

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(10_000);
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let mut seed: u64 = 42;
    let mut rnd = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let items: Vec<NewDrawer> = (0..n)
        .map(|i| {
            let len = 40 + (rnd() % 80) as usize;
            let text: Vec<&str> = (0..len)
                .map(|_| WORDS[(rnd() as usize) % WORDS.len()])
                .collect();
            NewDrawer {
                wing: format!("wing{}", i % 12),
                room: format!("room{}", i % 40),
                text: format!("drawer {i}: {}", text.join(" ")),
                source: None,
            }
        })
        .collect();
    let t = Instant::now();
    p.add_many(items).unwrap();
    let ins = t.elapsed();

    let t = Instant::now();
    for i in 0..50 {
        p.add(NewDrawer {
            wing: "bench".into(),
            room: "single".into(),
            text: format!("single add {i} tantivy"),
            source: None,
        })
        .unwrap();
    }
    let single = t.elapsed() / 50;

    let queries = [
        "durable object checkout",
        "rust tantivy latency",
        "kindergarten invoice stripe",
        "merge review branch",
        "drawer 4242",
    ];
    let mut lat = Vec::new();
    for _ in 0..200 {
        for q in queries {
            let t = Instant::now();
            let h = p
                .search(
                    q,
                    &SearchOpts {
                        limit: 10,
                        ..Default::default()
                    },
                )
                .unwrap();
            lat.push(t.elapsed().as_micros() as f64);
            assert!(!h.is_empty());
        }
    }
    let mut scoped = Vec::new();
    for _ in 0..200 {
        let t = Instant::now();
        p.search(
            "durable checkout",
            &SearchOpts {
                wing: Some("wing3".into()),
                room: Some("room3".into()),
                limit: 10,
            },
        )
        .unwrap();
        scoped.push(t.elapsed().as_micros() as f64);
    }
    let t = Instant::now();
    let w = p.list_wings().unwrap();
    let wings_us = t.elapsed().as_micros();

    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    scoped.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pct = |v: &Vec<f64>, q: f64| v[((v.len() as f64 - 1.0) * q) as usize];
    let size: u64 = std::fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(|e| e.ok()?.metadata().ok())
        .map(|m| m.len())
        .sum();
    println!("drawers: {n} (+50 single)");
    println!(
        "batch insert: {:.1} ms total ({:.1} µs/drawer)",
        ins.as_secs_f64() * 1e3,
        ins.as_secs_f64() * 1e6 / n as f64
    );
    println!(
        "single add+commit: {:.2} ms avg",
        single.as_secs_f64() * 1e3
    );
    println!(
        "search top-10 ({} q): p50 {:.0} µs, p95 {:.0} µs, p99 {:.0} µs",
        lat.len(),
        pct(&lat, 0.5),
        pct(&lat, 0.95),
        pct(&lat, 0.99)
    );
    println!(
        "scoped search wing+room: p50 {:.0} µs, p95 {:.0} µs",
        pct(&scoped, 0.5),
        pct(&scoped, 0.95)
    );
    println!("list_wings: {} wings in {} µs", w.len(), wings_us);
    println!("index size on disk: {:.1} MB", size as f64 / 1e6);
}
