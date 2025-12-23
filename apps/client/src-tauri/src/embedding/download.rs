// Model path utilities for bundled ONNX models
// Models are bundled with the app via tauri.conf.json resources

use std::path::{Path, PathBuf};

/// Get paths for bundled model files
/// Models are in the app's resource directory
pub fn get_model_paths(resource_dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let vision_path = resource_dir.join("models/nomic-embed-vision-v1.5/model.onnx");
    let text_path = resource_dir.join("models/nomic-embed-text-v1.5/model.onnx");
    let tokenizer_path = resource_dir.join("models/nomic-embed-text-v1.5/tokenizer.json");
    (vision_path, text_path, tokenizer_path)
}

/// Check if all models are available
pub fn models_exist(resource_dir: &Path) -> bool {
    let (vision, text, tokenizer) = get_model_paths(resource_dir);
    vision.exists() && text.exists() && tokenizer.exists()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelStatus {
    pub vision_available: bool,
    pub text_available: bool,
    pub tokenizer_available: bool,
}

impl ModelStatus {
    pub fn is_complete(&self) -> bool {
        self.vision_available && self.text_available && self.tokenizer_available
    }
}

/// Get status of bundled models
pub fn get_models_status(resource_dir: &Path) -> ModelStatus {
    let (vision_path, text_path, tokenizer_path) = get_model_paths(resource_dir);

    ModelStatus {
        vision_available: vision_path.exists(),
        text_available: text_path.exists(),
        tokenizer_available: tokenizer_path.exists(),
    }
}
