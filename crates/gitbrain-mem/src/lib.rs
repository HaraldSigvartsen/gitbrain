//! gitbrain-mem: local, verbatim, structured memory for AI agents.
//!
//! Memory is organised like a palace:
//! - a **wing** per person, agent or project (`harald`, `smakro`, `gitbrain`),
//! - a **room** per topic inside a wing (`decisions`, `auth`, `diary`),
//! - a **drawer** holding one piece of original text, stored verbatim.
//!
//! Drawers are indexed for BM25 full-text search with [tantivy]. With an
//! [`Embedder`] (the `embed` cargo feature ships a local multilingual model)
//! each drawer also gets a vector, and search fuses BM25 and vector rankings
//! with reciprocal rank fusion plus a small recency boost. Everything lives in
//! one directory on local disk; nothing leaves the machine.

#[cfg(feature = "embed")]
pub mod fastembed_impl;
pub mod mcp;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tantivy::collector::{DocSetCollector, TopDocs};
use tantivy::index::SegmentId;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, INDEXED, STORED,
    STRING,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
};
use tantivy::{
    doc, DocAddress, Index, IndexReader, IndexWriter, ReloadPolicy, Searcher, TantivyDocument, Term,
};

const TOKENIZER: &str = "gb_text";
const SEP: char = '\u{1f}';
const MAX_NAME_LEN: usize = 128;
const WRITER_HEAP_PER_THREAD: usize = 15_000_000;
const MERGE_AT_SEGMENTS: usize = 16;
/// Reciprocal rank fusion constant (Cormack et al.).
const RRF_K: f32 = 60.0;
/// Weight of the recency boost in hybrid mode: a brand-new drawer gets up to
/// +5% on its fused score, halving every [`RECENCY_HALF_LIFE_DAYS`].
const RECENCY_WEIGHT: f32 = 0.05;
const RECENCY_HALF_LIFE_DAYS: f32 = 30.0;
const LOCK_WAIT: Duration = Duration::from_secs(10);

/// A drawer to be stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewDrawer {
    pub wing: String,
    pub room: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// A stored drawer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Drawer {
    pub id: String,
    pub wing: String,
    pub room: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Unix seconds.
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hit {
    pub score: f32,
    #[serde(flatten)]
    pub drawer: Drawer,
}

/// How to rank results.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// Hybrid when the palace has an embedder, else BM25.
    #[default]
    Auto,
    /// Keyword ranking only.
    Bm25,
    /// Vector similarity only (needs an embedder).
    Vector,
    /// BM25 + vector fused with reciprocal rank fusion and a recency boost.
    Hybrid,
}

impl std::str::FromStr for SearchMode {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        Ok(match s.trim().to_ascii_lowercase().as_str() {
            "" | "auto" => Self::Auto,
            "bm25" | "keyword" => Self::Bm25,
            "vector" | "semantic" => Self::Vector,
            "hybrid" => Self::Hybrid,
            other => bail!("unknown search mode {other:?} (auto, bm25, vector, hybrid)"),
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct SearchOpts {
    pub wing: Option<String>,
    pub room: Option<String>,
    pub limit: usize,
    pub mode: SearchMode,
}

/// Turns text into vectors. Implementations must be deterministic for a given
/// model; vectors are L2-normalised by the palace before storage.
pub trait Embedder: Send + Sync {
    /// Short model identifier, e.g. `multilingual-e5-small`.
    fn name(&self) -> &str;
    fn embed_passages(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>>;
    fn embed_query(&self, query: &str) -> Result<Vec<f32>>;
}

/// Vectors of one immutable tantivy segment, decoded once and cached.
struct SegVecs {
    docs: Vec<u32>,
    created: Vec<u64>,
    dim: usize,
    data: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomInfo {
    pub room: String,
    pub drawers: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WingInfo {
    pub wing: String,
    pub drawers: u64,
    pub rooms: Vec<RoomInfo>,
}

struct Fields {
    id: Field,
    wing: Field,
    room: Field,
    wing_room: Field,
    text: Field,
    source: Field,
    created_at: Field,
    vec: Field,
}

/// A memory palace on local disk.
pub struct Palace {
    dir: PathBuf,
    index: Index,
    reader: IndexReader,
    f: Fields,
    embedder: Option<Arc<dyn Embedder>>,
    vec_cache: Mutex<HashMap<SegmentId, Arc<SegVecs>>>,
}

fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let text_opts = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer(TOKENIZER)
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();
    let f = Fields {
        id: b.add_text_field("id", STRING | STORED),
        wing: b.add_text_field("wing", STRING | STORED),
        room: b.add_text_field("room", STRING | STORED),
        wing_room: b.add_text_field("wing_room", STRING),
        text: b.add_text_field("text", text_opts),
        source: b.add_text_field("source", STORED),
        created_at: b.add_u64_field("created_at", STORED | INDEXED | FAST),
        // Little-endian f32 vector; empty when the drawer has no embedding.
        vec: b.add_bytes_field("vec", FAST),
    };
    (b.build(), f)
}

fn analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(64))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build()
}

/// Default palace location: `$GITBRAIN_MEM_DIR`, else `~/.gitbrain/palace`.
pub fn default_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("GITBRAIN_MEM_DIR") {
        return PathBuf::from(d);
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".gitbrain").join("palace")
}

fn validate_name(kind: &str, v: &str) -> Result<String> {
    let v = v.trim();
    if v.is_empty() {
        bail!("{kind} must not be empty");
    }
    if v.chars().count() > MAX_NAME_LEN {
        bail!("{kind} is longer than {MAX_NAME_LEN} characters");
    }
    if v.chars().any(|c| c.is_control()) {
        bail!("{kind} must not contain control characters");
    }
    Ok(v.to_string())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Palace {
    /// Open (or create) the palace in `dir`. With the `embed` feature the
    /// default local embedder is attached (set `GITBRAIN_MEM_EMBED=0` to
    /// disable); without it the palace is BM25-only.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let p = Self::open_bm25(dir)?;
        #[cfg(feature = "embed")]
        if std::env::var("GITBRAIN_MEM_EMBED").as_deref() != Ok("0") {
            return Ok(p.with_embedder(Arc::new(fastembed_impl::FastEmbedder::from_env())));
        }
        Ok(p)
    }

    /// Attach an embedder: new drawers get vectors and `Auto` search is hybrid.
    pub fn with_embedder(mut self, e: Arc<dyn Embedder>) -> Self {
        self.embedder = Some(e);
        self
    }

    pub fn has_embedder(&self) -> bool {
        self.embedder.is_some()
    }

    /// Open (or create) the palace without an embedder.
    pub fn open_bm25(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create palace directory {}", dir.display()))?;
        let (schema, f) = schema();
        let mmap = tantivy::directory::MmapDirectory::open(&dir)
            .with_context(|| format!("cannot open palace at {}", dir.display()))?;
        let index = Index::open_or_create(mmap, schema)
            .with_context(|| format!("cannot open palace index at {}", dir.display()))?;
        index.tokenizers().register(TOKENIZER, analyzer());
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            dir,
            index,
            reader,
            f,
            embedder: None,
            vec_cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Acquire the single-writer lock, waiting briefly if another process
    /// (another agent's MCP server) is writing right now.
    fn writer(&self, batch: usize) -> Result<IndexWriter> {
        let threads = if batch < 1000 { 1 } else { 4 };
        let start = Instant::now();
        loop {
            match self
                .index
                .writer_with_num_threads(threads, WRITER_HEAP_PER_THREAD * threads)
            {
                Ok(w) => return Ok(w),
                Err(tantivy::TantivyError::LockFailure(..)) if start.elapsed() < LOCK_WAIT => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e) => return Err(e).context("palace is locked by another writer"),
            }
        }
    }

    /// Store one drawer verbatim.
    pub fn add(&self, d: NewDrawer) -> Result<Drawer> {
        Ok(self.add_many(vec![d])?.remove(0))
    }

    /// Store many drawers in a single commit.
    pub fn add_many(&self, items: Vec<NewDrawer>) -> Result<Vec<Drawer>> {
        let mut out = Vec::with_capacity(items.len());
        for d in items {
            let wing = validate_name("wing", &d.wing)?;
            let room = validate_name("room", &d.room)?;
            if d.text.trim().is_empty() {
                bail!("text must not be empty");
            }
            out.push(Drawer {
                id: uuid::Uuid::new_v4().to_string(),
                wing,
                room,
                text: d.text,
                source: d.source.filter(|s| !s.trim().is_empty()),
                created_at: now(),
            });
        }
        if out.is_empty() {
            return Ok(out);
        }
        // Embed before taking the writer lock (the model is the slow part).
        let vectors: Vec<Option<Vec<u8>>> = match &self.embedder {
            Some(e) => {
                let texts: Vec<&str> = out.iter().map(|d| d.text.as_str()).collect();
                match e.embed_passages(&texts) {
                    Ok(vs) => vs
                        .into_iter()
                        .map(|v| Some(vec_to_bytes(&normalize(v))))
                        .collect(),
                    Err(err) => {
                        eprintln!(
                            "gitbrain-mem: embedding failed, storing without vectors: {err:#}"
                        );
                        vec![None; out.len()]
                    }
                }
            }
            None => vec![None; out.len()],
        };
        let mut w = self.writer(out.len())?;
        // Small writes commit fast without merging; once segments pile up the
        // default log-merge policy compacts them (on writer drop).
        let segments = self.index.searchable_segment_ids()?.len();
        if segments < MERGE_AT_SEGMENTS {
            w.set_merge_policy(Box::new(tantivy::indexer::NoMergePolicy));
        }
        let f = &self.f;
        for (d, v) in out.iter().zip(vectors) {
            let mut doc = doc!(
                f.id => d.id.as_str(),
                f.wing => d.wing.as_str(),
                f.room => d.room.as_str(),
                f.wing_room => format!("{}{SEP}{}", d.wing, d.room),
                f.text => d.text.as_str(),
                f.created_at => d.created_at,
            );
            if let Some(s) = &d.source {
                doc.add_text(f.source, s);
            }
            if let Some(v) = v {
                doc.add_bytes(f.vec, &v);
            }
            w.add_document(doc)?;
        }
        w.commit()?;
        w.wait_merging_threads()?;
        if segments >= MERGE_AT_SEGMENTS {
            // Drop files of merged-away segments.
            let _ = self
                .index
                .writer_with_num_threads::<TantivyDocument>(1, WRITER_HEAP_PER_THREAD)
                .map(|w| w.garbage_collect_files().wait());
        }
        self.reader.reload()?;
        Ok(out)
    }

    fn to_drawer(&self, doc: &TantivyDocument) -> Drawer {
        let s = |field| {
            doc.get_first(field)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };
        Drawer {
            id: s(self.f.id),
            wing: s(self.f.wing),
            room: s(self.f.room),
            text: s(self.f.text),
            source: doc
                .get_first(self.f.source)
                .and_then(|v| v.as_str())
                .map(str::to_string),
            created_at: doc
                .get_first(self.f.created_at)
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        }
    }

    fn filter_clauses(&self, opts: &SearchOpts) -> Vec<(Occur, Box<dyn Query>)> {
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let scoped = [(self.f.wing, &opts.wing), (self.f.room, &opts.room)];
        for (field, v) in scoped {
            if let Some(v) = v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                clauses.push((
                    Occur::Must,
                    Box::new(TermQuery::new(
                        Term::from_field_text(field, v),
                        IndexRecordOption::Basic,
                    )),
                ));
            }
        }
        clauses
    }

    fn bm25(
        &self,
        searcher: &Searcher,
        query: &str,
        opts: &SearchOpts,
        n: usize,
    ) -> Result<Vec<(f32, DocAddress)>> {
        let parser = QueryParser::for_index(&self.index, vec![self.f.text]);
        let (q, _errors) = parser.parse_query_lenient(query);
        let mut clauses = self.filter_clauses(opts);
        clauses.insert(0, (Occur::Must, q));
        Ok(searcher.search(
            &BooleanQuery::new(clauses),
            &TopDocs::with_limit(n).order_by_score(),
        )?)
    }

    fn seg_vecs(&self, searcher: &Searcher, ord: usize) -> Result<Arc<SegVecs>> {
        let seg = searcher.segment_reader(ord as u32);
        let id = seg.segment_id();
        if let Some(v) = self.vec_cache.lock().unwrap().get(&id) {
            return Ok(v.clone());
        }
        let ff = seg.fast_fields();
        let mut sv = SegVecs {
            docs: Vec::new(),
            created: Vec::new(),
            dim: 0,
            data: Vec::new(),
        };
        if let Some(col) = ff.bytes("vec")? {
            let created = ff.u64("created_at")?;
            let mut buf = Vec::new();
            for doc in 0..seg.max_doc() {
                if seg.alive_bitset().is_some_and(|a| a.is_deleted(doc)) {
                    continue;
                }
                let Some(ord) = col.term_ords(doc).next() else {
                    continue;
                };
                buf.clear();
                col.ord_to_bytes(ord, &mut buf)?;
                if buf.is_empty() || buf.len() % 4 != 0 {
                    continue;
                }
                let dim = buf.len() / 4;
                if sv.dim == 0 {
                    sv.dim = dim;
                } else if sv.dim != dim {
                    continue; // vector from a different model; ignore
                }
                sv.docs.push(doc);
                sv.created.push(created.first(doc).unwrap_or(0));
                sv.data.extend(bytes_to_vec(&buf));
            }
        }
        let sv = Arc::new(sv);
        let mut cache = self.vec_cache.lock().unwrap();
        // Segments are immutable; drop entries for segments merged away.
        let live: std::collections::HashSet<SegmentId> = searcher
            .segment_readers()
            .iter()
            .map(|s| s.segment_id())
            .collect();
        cache.retain(|k, _| live.contains(k));
        cache.insert(id, sv.clone());
        Ok(sv)
    }

    fn vector(
        &self,
        searcher: &Searcher,
        qv: &[f32],
        opts: &SearchOpts,
        n: usize,
    ) -> Result<Vec<(f32, DocAddress)>> {
        let clauses = self.filter_clauses(opts);
        let allowed = if clauses.is_empty() {
            None
        } else {
            Some(searcher.search(&BooleanQuery::new(clauses), &DocSetCollector)?)
        };
        let mut scored: Vec<(f32, DocAddress)> = Vec::new();
        for ord in 0..searcher.segment_readers().len() {
            let sv = self.seg_vecs(searcher, ord)?;
            if sv.dim != qv.len() {
                continue;
            }
            for (i, row) in sv.data.chunks_exact(sv.dim).enumerate() {
                let addr = DocAddress::new(ord as u32, sv.docs[i]);
                if allowed.as_ref().is_some_and(|a| !a.contains(&addr)) {
                    continue;
                }
                let dot: f32 = row.iter().zip(qv).map(|(a, b)| a * b).sum();
                scored.push((dot, addr));
            }
        }
        let n = n.min(scored.len());
        if n == 0 {
            return Ok(Vec::new());
        }
        scored.select_nth_unstable_by(n - 1, |a, b| b.0.total_cmp(&a.0));
        scored.truncate(n);
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        Ok(scored)
    }

    fn created_at(&self, searcher: &Searcher, addr: DocAddress) -> u64 {
        if let Ok(sv) = self.seg_vecs(searcher, addr.segment_ord as usize) {
            if let Ok(i) = sv.docs.binary_search(&addr.doc_id) {
                return sv.created[i];
            }
        }
        let seg = searcher.segment_reader(addr.segment_ord);
        seg.fast_fields()
            .u64("created_at")
            .ok()
            .and_then(|c| c.first(addr.doc_id))
            .unwrap_or(0)
    }

    /// Search drawer text, optionally scoped to a wing and/or room.
    ///
    /// `Auto` is hybrid when an embedder is attached: BM25 and vector top-N
    /// lists are fused with reciprocal rank fusion (k = 60) and boosted
    /// slightly for recency. Without an embedder it is plain BM25.
    pub fn search(&self, query: &str, opts: &SearchOpts) -> Result<Vec<Hit>> {
        self.reader.reload()?;
        let searcher = self.reader.searcher();
        let limit = if opts.limit == 0 {
            10
        } else {
            opts.limit.min(200)
        };
        let mode = match (opts.mode, &self.embedder) {
            (SearchMode::Auto, Some(_)) => SearchMode::Hybrid,
            (SearchMode::Auto, None) => SearchMode::Bm25,
            (m @ (SearchMode::Vector | SearchMode::Hybrid), None) => {
                bail!("{m:?} search needs an embedder (build with --features embed)")
            }
            (m, _) => m,
        };
        let query_vec = |e: &Arc<dyn Embedder>| e.embed_query(query).map(normalize);
        let ranked: Vec<(f32, DocAddress)> = match mode {
            SearchMode::Bm25 | SearchMode::Auto => self.bm25(&searcher, query, opts, limit)?,
            SearchMode::Vector => {
                let qv = query_vec(self.embedder.as_ref().unwrap())?;
                self.vector(&searcher, &qv, opts, limit)?
            }
            SearchMode::Hybrid => {
                let n = (limit * 5).max(50);
                let lexical = self.bm25(&searcher, query, opts, n)?;
                let semantic = match query_vec(self.embedder.as_ref().unwrap()) {
                    Ok(qv) => self.vector(&searcher, &qv, opts, n)?,
                    Err(err) => {
                        eprintln!("gitbrain-mem: query embedding failed, using BM25: {err:#}");
                        Vec::new()
                    }
                };
                let mut fused: HashMap<DocAddress, f32> = HashMap::new();
                for list in [&lexical, &semantic] {
                    for (rank, (_, addr)) in list.iter().enumerate() {
                        *fused.entry(*addr).or_default() += 1.0 / (RRF_K + rank as f32 + 1.0);
                    }
                }
                let now = now();
                let mut out: Vec<(f32, DocAddress)> = fused
                    .into_iter()
                    .map(|(addr, s)| {
                        let age_days =
                            now.saturating_sub(self.created_at(&searcher, addr)) as f32 / 86_400.0;
                        let boost =
                            1.0 + RECENCY_WEIGHT * 0.5f32.powf(age_days / RECENCY_HALF_LIFE_DAYS);
                        (s * boost, addr)
                    })
                    .collect();
                out.sort_by(|a, b| b.0.total_cmp(&a.0));
                out.truncate(limit);
                out
            }
        };
        let mut hits = Vec::with_capacity(ranked.len());
        for (score, addr) in ranked {
            let doc: TantivyDocument = searcher.doc(addr)?;
            hits.push(Hit {
                score,
                drawer: self.to_drawer(&doc),
            });
        }
        Ok(hits)
    }

    /// Fetch one drawer by id.
    pub fn get(&self, id: &str) -> Result<Option<Drawer>> {
        self.reader.reload()?;
        let searcher = self.reader.searcher();
        let q = TermQuery::new(
            Term::from_field_text(self.f.id, id),
            IndexRecordOption::Basic,
        );
        let top = searcher.search(&q, &TopDocs::with_limit(1).order_by_score())?;
        match top.first() {
            Some((_, addr)) => Ok(Some(self.to_drawer(&searcher.doc(*addr)?))),
            None => Ok(None),
        }
    }

    /// All wings with their rooms and drawer counts, read straight from the
    /// term dictionary (no document scan).
    pub fn list_wings(&self) -> Result<Vec<WingInfo>> {
        self.reader.reload()?;
        let searcher = self.reader.searcher();
        let mut map: std::collections::BTreeMap<String, std::collections::BTreeMap<String, u64>> =
            Default::default();
        for seg in searcher.segment_readers() {
            let inv = seg.inverted_index(self.f.wing_room)?;
            let mut stream = inv.terms().stream()?;
            while stream.advance() {
                let key = String::from_utf8_lossy(stream.key()).into_owned();
                let n = stream.value().doc_freq as u64;
                if let Some((w, r)) = key.split_once(SEP) {
                    *map.entry(w.to_string())
                        .or_default()
                        .entry(r.to_string())
                        .or_default() += n;
                }
            }
        }
        Ok(map
            .into_iter()
            .map(|(wing, rooms)| WingInfo {
                drawers: rooms.values().sum(),
                rooms: rooms
                    .into_iter()
                    .map(|(room, drawers)| RoomInfo { room, drawers })
                    .collect(),
                wing,
            })
            .collect())
    }
}

fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
    v
}

fn vec_to_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn bytes_to_vec(b: &[u8]) -> impl Iterator<Item = f32> + '_ {
    b.as_chunks::<4>().0.iter().map(|c| f32::from_le_bytes(*c))
}
