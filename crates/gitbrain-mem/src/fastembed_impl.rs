//! Default local embedder: `intfloat/multilingual-e5-small` (384 dims,
//! 100+ languages including Norwegian) via fastembed / ONNX Runtime.
//! The model is downloaded once on first use; nothing is sent anywhere else.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use anyhow::{anyhow, Result};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};

use crate::Embedder;

pub const MODEL_NAME: &str = "multilingual-e5-small";

pub struct FastEmbedder {
    cache_dir: PathBuf,
    model: OnceLock<std::result::Result<Mutex<TextEmbedding>, String>>,
}

impl FastEmbedder {
    /// Model cache: `$GITBRAIN_MEM_MODEL_DIR`, else `~/.gitbrain/models`.
    pub fn from_env() -> Self {
        let cache_dir = std::env::var_os("GITBRAIN_MEM_MODEL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                crate::default_dir()
                    .parent()
                    .map(|p| p.join("models"))
                    .unwrap_or_else(|| PathBuf::from("models"))
            });
        Self {
            cache_dir,
            model: OnceLock::new(),
        }
    }

    fn with_model<T>(&self, f: impl FnOnce(&mut TextEmbedding) -> Result<T>) -> Result<T> {
        let m = self.model.get_or_init(|| {
            TextEmbedding::try_new(
                TextInitOptions::new(EmbeddingModel::MultilingualE5Small)
                    .with_cache_dir(self.cache_dir.clone())
                    .with_show_download_progress(false),
            )
            .map(Mutex::new)
            .map_err(|e| format!("cannot load {MODEL_NAME}: {e}"))
        });
        let m = m.as_ref().map_err(|e| anyhow!("{e}"))?;
        let mut guard = m.lock().map_err(|_| anyhow!("embedder poisoned"))?;
        f(&mut guard)
    }
}

impl Embedder for FastEmbedder {
    fn name(&self) -> &str {
        MODEL_NAME
    }

    fn embed_passages(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        // E5 models expect "passage: " / "query: " prefixes.
        let inputs: Vec<String> = texts.iter().map(|t| format!("passage: {t}")).collect();
        self.with_model(|m| Ok(m.embed(&inputs, Some(64))?))
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>> {
        let input = [format!("query: {query}")];
        self.with_model(|m| {
            m.embed(&input, None)?
                .pop()
                .ok_or_else(|| anyhow!("empty embedding"))
        })
    }
}
