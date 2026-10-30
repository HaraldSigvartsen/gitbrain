//! Hybrid search with a toy concept embedder (no model download needed).

use std::sync::Arc;

use anyhow::Result;
use gitbrain_mem::{mcp, Embedder, NewDrawer, Palace, SearchMode, SearchOpts};

/// Maps words to concept dimensions so paraphrases (and Norwegian/English
/// pairs) land close together while sharing no keywords.
struct Concepts;

const GROUPS: &[&[&str]] = &[
    &["car", "bil", "automobile", "vehicle", "sedan"],
    &["dog", "hund", "puppy", "canine"],
    &["money", "penger", "cash", "salary", "lønn", "lonn"],
    &["holiday", "ferie", "vacation", "trip"],
    &["sick", "syk", "ill", "fever"],
];

impl Embedder for Concepts {
    fn name(&self) -> &str {
        "concepts"
    }
    fn embed_passages(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| self.vec(t)).collect())
    }
    fn embed_query(&self, q: &str) -> Result<Vec<f32>> {
        Ok(self.vec(q))
    }
}

impl Concepts {
    fn vec(&self, t: &str) -> Vec<f32> {
        let mut v = vec![0.01; GROUPS.len() + 1];
        for w in t.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
            for (i, g) in GROUPS.iter().enumerate() {
                if g.contains(&w) {
                    v[i] += 1.0;
                }
            }
        }
        v
    }
}

struct Broken;
impl Embedder for Broken {
    fn name(&self) -> &str {
        "broken"
    }
    fn embed_passages(&self, _: &[&str]) -> Result<Vec<Vec<f32>>> {
        anyhow::bail!("model missing")
    }
    fn embed_query(&self, _: &str) -> Result<Vec<f32>> {
        anyhow::bail!("model missing")
    }
}

fn d(wing: &str, room: &str, text: &str) -> NewDrawer {
    NewDrawer {
        wing: wing.into(),
        room: room.into(),
        text: text.into(),
        source: None,
    }
}

fn mode(m: SearchMode, limit: usize) -> SearchOpts {
    SearchOpts {
        limit,
        mode: m,
        ..Default::default()
    }
}

fn palace(dir: &std::path::Path) -> Palace {
    Palace::open_bm25(dir)
        .unwrap()
        .with_embedder(Arc::new(Concepts))
}

fn seed(p: &Palace) {
    p.add_many(vec![
        d("harald", "family", "Vi tar ferie i Spania i juli"),
        d(
            "harald",
            "garage",
            "Bilen må på EU-kontroll i mars, ring verkstedet",
        ),
        d(
            "harald",
            "pets",
            "The puppy needs a vet appointment next week",
        ),
        d("smakro", "finance", "Salary run happens on the 20th"),
    ])
    .unwrap();
}

#[test]
fn hybrid_finds_paraphrases_bm25_misses() {
    let tmp = tempfile::tempdir().unwrap();
    let p = palace(tmp.path());
    seed(&p);
    // "vacation" shares no token with the Norwegian drawer.
    assert!(p
        .search("vacation plans", &mode(SearchMode::Bm25, 5))
        .unwrap()
        .is_empty());
    let hy = p
        .search("vacation plans", &mode(SearchMode::Hybrid, 1))
        .unwrap();
    assert_eq!(hy[0].drawer.room, "family");
    let auto = p.search("dog", &mode(SearchMode::Auto, 1)).unwrap();
    assert_eq!(
        auto[0].drawer.room, "pets",
        "auto is hybrid with an embedder"
    );
}

#[test]
fn hybrid_keeps_exact_keyword_matches_on_top() {
    let tmp = tempfile::tempdir().unwrap();
    let p = palace(tmp.path());
    seed(&p);
    p.add(d("harald", "garage", "EU-kontroll booket hos Mekonomen"))
        .unwrap();
    let hits = p.search("Mekonomen", &mode(SearchMode::Hybrid, 3)).unwrap();
    assert!(hits[0].drawer.text.contains("Mekonomen"));
}

#[test]
fn vector_search_respects_wing_and_room_filters() {
    let tmp = tempfile::tempdir().unwrap();
    let p = palace(tmp.path());
    seed(&p);
    p.add(d("smakro", "fleet", "Company car lease renewal"))
        .unwrap();
    let opts = SearchOpts {
        wing: Some("smakro".into()),
        limit: 10,
        mode: SearchMode::Vector,
        ..Default::default()
    };
    let hits = p.search("bil", &opts).unwrap();
    assert!(hits.iter().all(|h| h.drawer.wing == "smakro"));
    assert_eq!(hits[0].drawer.room, "fleet");
    let opts = SearchOpts {
        wing: Some("harald".into()),
        room: Some("garage".into()),
        limit: 10,
        mode: SearchMode::Hybrid,
    };
    let hits = p.search("vehicle", &opts).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].drawer.room, "garage");
}

#[test]
fn drawers_without_vectors_are_still_found() {
    let tmp = tempfile::tempdir().unwrap();
    Palace::open_bm25(tmp.path())
        .unwrap()
        .add(d("old", "notes", "legacy drawer about kubernetes"))
        .unwrap();
    let p = palace(tmp.path());
    p.add(d("new", "notes", "fresh drawer about dogs")).unwrap();
    let hits = p
        .search("kubernetes", &mode(SearchMode::Hybrid, 5))
        .unwrap();
    // The legacy drawer has no vector; it must still come back via BM25.
    // (It ties with the vector-side rank 1 in RRF, so don't assert order.)
    assert!(hits.iter().any(|h| h.drawer.wing == "old"));
    let hits = p.search("canine", &mode(SearchMode::Vector, 5)).unwrap();
    assert_eq!(hits[0].drawer.wing, "new");
}

#[test]
fn vectors_survive_segment_merges() {
    let tmp = tempfile::tempdir().unwrap();
    let p = palace(tmp.path());
    for i in 0..40 {
        p.add(d("w", "r", &format!("note {i} about a sedan")))
            .unwrap();
    }
    p.add(d("w", "r", "the fever is gone")).unwrap();
    let hits = p.search("syk", &mode(SearchMode::Vector, 1)).unwrap();
    assert_eq!(hits[0].drawer.text, "the fever is gone");
    assert_eq!(
        p.search("bil", &mode(SearchMode::Vector, 100))
            .unwrap()
            .len(),
        41
    );
}

#[test]
fn bm25_only_palace_rejects_vector_modes_and_auto_falls_back() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open_bm25(tmp.path()).unwrap();
    seed(&p);
    assert!(p.search("dog", &mode(SearchMode::Vector, 5)).is_err());
    assert!(p.search("dog", &mode(SearchMode::Hybrid, 5)).is_err());
    assert_eq!(
        p.search("puppy", &mode(SearchMode::Auto, 5)).unwrap().len(),
        1
    );
}

#[test]
fn embedder_failure_does_not_lose_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open_bm25(tmp.path())
        .unwrap()
        .with_embedder(Arc::new(Broken));
    p.add(d("w", "r", "still stored")).unwrap();
    let hits = p.search("stored", &mode(SearchMode::Hybrid, 5)).unwrap();
    assert_eq!(hits.len(), 1);
}

#[test]
fn mcp_search_accepts_mode() {
    let tmp = tempfile::tempdir().unwrap();
    let p = palace(tmp.path());
    seed(&p);
    let call = |args: serde_json::Value| {
        mcp::handle(
            &p,
            &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_search","arguments":args}}).to_string(),
        )
        .unwrap()
    };
    let r = call(serde_json::json!({"query": "vacation", "mode": "hybrid", "limit": 1}));
    assert_eq!(
        r["result"]["structuredContent"]["result"][0]["room"],
        "family"
    );
    let r = call(serde_json::json!({"query": "vacation", "mode": "nope"}));
    assert_eq!(r["result"]["isError"], true);
}
