// Semantic image search using Nomic embedding models
// - nomic-embed-vision-v1.5 for image embeddings
// - nomic-embed-text-v1.5 for query embeddings

pub mod download;
pub mod preprocess;
pub mod search;


use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub use download::{get_model_paths, models_exist};
pub use search::EmbeddingIndex;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod text_desktop;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod vision_desktop;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod text_mobile;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod vision_mobile;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use text_desktop::TextEmbedder;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use vision_desktop::VisionEmbedder;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub use text_mobile::TextEmbedder;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub use vision_mobile::VisionEmbedder;


/// Managed state for embedding models
#[derive(Clone)]
pub struct EmbeddingState {
    pub vision: Arc<Mutex<Option<VisionEmbedder>>>,
    pub text: Arc<Mutex<Option<TextEmbedder>>>,
    pub index: Arc<Mutex<EmbeddingIndex>>,
}

impl EmbeddingState {
    pub fn new(_models_dir: PathBuf) -> Self {
        Self {
            vision: Arc::new(Mutex::new(None)),
            text: Arc::new(Mutex::new(None)),
            index: Arc::new(Mutex::new(EmbeddingIndex::new())),
        }
    }

    /// Check if models are loaded and ready
    pub async fn is_ready(&self) -> bool {
        let vision = self.vision.lock().await;
        let text = self.text.lock().await;
        vision.is_some() && text.is_some()
    }
}
