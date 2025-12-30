use ndarray::Array1;
use std::path::Path;

pub struct VisionEmbedder;

impl VisionEmbedder {
    pub fn new(_model_path: &Path) -> Result<Self, String> {
        Err("Vision embedding is not supported on mobile platforms".to_string())
    }

    pub fn embed(&mut self, _pixel_values: ndarray::Array4<f32>) -> Result<Array1<f32>, String> {
        Err("Vision embedding is not supported on mobile platforms".to_string())
    }
}
