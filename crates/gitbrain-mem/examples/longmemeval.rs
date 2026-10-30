//! Session-level retrieval recall on LongMemEval-S.
//!
//! ```text
//! cargo run --release --features embed --example longmemeval -- \
//!     longmemeval_s_cleaned.json [per_type=17]
//! ```
//!
//! For each question, every user turn of its haystack becomes one drawer
//! (source = session id) in a fresh palace. Turns are ranked, mapped to their
//! sessions (first occurrence wins) and R@5 / R@10 are computed against
//! `answer_session_ids` for BM25, vector and hybrid modes. No LLM involved.
//! `per_type` questions are taken from each of the six question types.

use std::collections::{BTreeMap, HashSet};
use std::time::Instant;

use gitbrain_mem::{NewDrawer, Palace, SearchMode, SearchOpts};
use serde_json::Value;

const MODES: [(SearchMode, &str); 3] = [
    (SearchMode::Bm25, "bm25"),
    (SearchMode::Vector, "vector"),
    (SearchMode::Hybrid, "hybrid"),
];

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: longmemeval <longmemeval_s_cleaned.json> [per_type]");
    let per_type: usize = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(17);
    let data: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

    let mut taken: BTreeMap<String, usize> = BTreeMap::new();
    let questions: Vec<&Value> = data
        .iter()
        .filter(|q| {
            let t = q["question_type"].as_str().unwrap_or("").to_string();
            let n = taken.entry(t).or_default();
            *n += 1;
            *n <= per_type
        })
        .collect();

    // [mode][type] -> (hits@5, hits@10, n)
    let mut stats: BTreeMap<(&str, String), (u32, u32, u32)> = BTreeMap::new();
    let mut lat: BTreeMap<&str, Vec<f64>> = BTreeMap::new();
    let mut drawers_total = 0usize;
    let started = Instant::now();
    let mut embed_secs = 0.0;

    for (qi, q) in questions.iter().enumerate() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Palace::open(tmp.path()).unwrap();
        assert!(p.has_embedder(), "build with --features embed");
        let mut items = Vec::new();
        let ids = q["haystack_session_ids"].as_array().unwrap();
        for (si, sess) in q["haystack_sessions"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let sid = ids[si].as_str().unwrap();
            for turn in sess.as_array().unwrap() {
                if turn["role"] != "user" {
                    continue;
                }
                let text = turn["content"].as_str().unwrap_or("").trim();
                if text.is_empty() {
                    continue;
                }
                items.push(NewDrawer {
                    wing: "lme".into(),
                    room: "chat".into(),
                    text: text.to_string(),
                    source: Some(sid.to_string()),
                });
            }
        }
        drawers_total += items.len();
        let t = Instant::now();
        p.add_many(items).unwrap();
        embed_secs += t.elapsed().as_secs_f64();

        let answers: HashSet<&str> = q["answer_session_ids"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        let qtype = q["question_type"].as_str().unwrap().to_string();
        let question = q["question"].as_str().unwrap();
        for (mode, name) in MODES {
            let t = Instant::now();
            let hits = p
                .search(
                    question,
                    &SearchOpts {
                        limit: 100,
                        mode,
                        ..Default::default()
                    },
                )
                .unwrap();
            lat.entry(name)
                .or_default()
                .push(t.elapsed().as_secs_f64() * 1e3);
            let mut sessions: Vec<String> = Vec::new();
            for h in hits {
                let s = h.drawer.source.unwrap_or_default();
                if !sessions.contains(&s) {
                    sessions.push(s);
                }
            }
            let hit_at = |k: usize| {
                sessions
                    .iter()
                    .take(k)
                    .any(|s| answers.contains(s.as_str()))
            };
            for key in [(name, qtype.clone()), (name, "ALL".to_string())] {
                let e = stats.entry(key).or_default();
                e.0 += hit_at(5) as u32;
                e.1 += hit_at(10) as u32;
                e.2 += 1;
            }
        }
        eprintln!(
            "[{}/{}] {:.0}s elapsed",
            qi + 1,
            questions.len(),
            started.elapsed().as_secs_f64()
        );
    }

    println!(
        "questions: {}  drawers: {}  embedding time: {:.0}s ({:.1} ms/drawer)",
        questions.len(),
        drawers_total,
        embed_secs,
        embed_secs * 1e3 / drawers_total as f64
    );
    println!(
        "{:<8} {:<28} {:>6} {:>6} {:>4}",
        "mode", "type", "R@5", "R@10", "n"
    );
    for ((mode, ty), (h5, h10, n)) in &stats {
        println!(
            "{:<8} {:<28} {:>5.1}% {:>5.1}% {:>4}",
            mode,
            ty,
            100.0 * *h5 as f64 / *n as f64,
            100.0 * *h10 as f64 / *n as f64,
            n
        );
    }
    for (mode, mut v) in lat {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!(
            "{mode} query latency (~{} drawers/palace): p50 {:.2} ms, p95 {:.2} ms",
            drawers_total / questions.len(),
            v[v.len() / 2],
            v[(v.len() as f64 * 0.95) as usize]
        );
    }
}
