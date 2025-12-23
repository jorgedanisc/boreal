// Semantic image search using Nomic embedding models
// - nomic-embed-vision-v1.5 for image embeddings
// - nomic-embed-text-v1.5 for query embeddings

pub mod download;
pub mod preprocess;
pub mod search;
pub mod text;
pub mod vision;

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub use download::{get_model_paths, get_models_status, models_exist, ModelStatus};
pub use search::EmbeddingIndex;
pub use text::TextEmbedder;
pub use vision::VisionEmbedder;

/// Managed state for embedding models
#[derive(Clone)]
pub struct EmbeddingState {
    pub vision: Arc<Mutex<Option<VisionEmbedder>>>,
    pub text: Arc<Mutex<Option<TextEmbedder>>>,
    pub index: Arc<Mutex<EmbeddingIndex>>,
    pub models_dir: PathBuf,
}

impl EmbeddingState {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            vision: Arc::new(Mutex::new(None)),
            text: Arc::new(Mutex::new(None)),
            index: Arc::new(Mutex::new(EmbeddingIndex::new())),
            models_dir,
        }
    }

    /// Check if models are loaded and ready
    pub async fn is_ready(&self) -> bool {
        let vision = self.vision.lock().await;
        let text = self.text.lock().await;
        vision.is_some() && text.is_some()
    }
}
