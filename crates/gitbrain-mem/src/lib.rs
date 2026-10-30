//! gitbrain-mem: local, verbatim, structured memory for AI agents.
//!
//! Memory is organised like a palace:
//! - a **wing** per person, agent or project (`harald`, `smakro`, `gitbrain`),
//! - a **room** per topic inside a wing (`decisions`, `auth`, `diary`),
//! - a **drawer** holding one piece of original text, stored verbatim.
//!
//! Drawers are indexed for BM25 full-text search with [tantivy]. Everything
//! lives in one directory on local disk; nothing leaves the machine.

pub mod mcp;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, INDEXED, STORED,
    STRING,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

const TOKENIZER: &str = "gb_text";
const SEP: char = '\u{1f}';
const MAX_NAME_LEN: usize = 128;
const WRITER_HEAP_PER_THREAD: usize = 15_000_000;
const MERGE_AT_SEGMENTS: usize = 16;
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

#[derive(Debug, Clone, Default)]
pub struct SearchOpts {
    pub wing: Option<String>,
    pub room: Option<String>,
    pub limit: usize,
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
}

/// A memory palace on local disk.
pub struct Palace {
    dir: PathBuf,
    index: Index,
    reader: IndexReader,
    f: Fields,
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
    /// Open (or create) the palace in `dir`.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
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
        let mut w = self.writer(out.len())?;
        // Small writes commit fast without merging; once segments pile up the
        // default log-merge policy compacts them (on writer drop).
        let segments = self.index.searchable_segment_ids()?.len();
        if segments < MERGE_AT_SEGMENTS {
            w.set_merge_policy(Box::new(tantivy::indexer::NoMergePolicy));
        }
        let f = &self.f;
        for d in &out {
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

    /// BM25 search over drawer text, optionally scoped to a wing and/or room.
    pub fn search(&self, query: &str, opts: &SearchOpts) -> Result<Vec<Hit>> {
        self.reader.reload()?;
        let searcher = self.reader.searcher();
        let parser = QueryParser::for_index(&self.index, vec![self.f.text]);
        let (q, _errors) = parser.parse_query_lenient(query);
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, q)];
        if let Some(w) = opts
            .wing
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push((
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(self.f.wing, w),
                    IndexRecordOption::Basic,
                )),
            ));
        }
        if let Some(r) = opts
            .room
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push((
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(self.f.room, r),
                    IndexRecordOption::Basic,
                )),
            ));
        }
        let limit = if opts.limit == 0 {
            10
        } else {
            opts.limit.min(200)
        };
        let top = searcher.search(
            &BooleanQuery::new(clauses),
            &TopDocs::with_limit(limit).order_by_score(),
        )?;
        let mut hits = Vec::with_capacity(top.len());
        for (score, addr) in top {
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
