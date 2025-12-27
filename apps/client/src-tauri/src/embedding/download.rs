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

/// Check if all model files exist
pub fn models_exist(resource_dir: &Path) -> bool {
    let (vision, text, tokenizer) = get_model_paths(resource_dir);
    vision.exists() && text.exists() && tokenizer.exists()
}

