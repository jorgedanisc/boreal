use ndarray::Array1;
use std::path::Path;

pub struct TextEmbedder;

impl TextEmbedder {
    pub fn new(_model_path: &Path, _tokenizer_path: &Path) -> Result<Self, String> {
        Err("Text embedding is not supported on mobile platforms".to_string())
    }

    pub fn embed_query(&mut self, _query: &str) -> Result<Array1<f32>, String> {
        Err("Text embedding is not supported on mobile platforms".to_string())
    }

    pub fn embed_text(&mut self, _text: &str) -> Result<Array1<f32>, String> {
        Err("Text embedding is not supported on mobile platforms".to_string())
    }
}
