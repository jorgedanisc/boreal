// Vision embedding using nomic-embed-vision-v1.5 ONNX model
// Extracts CLS token and L2 normalizes to 768-dim vector

use ndarray::Array1;
use ort::{session::Session, value::Tensor};
use std::path::Path;

pub struct VisionEmbedder {
    session: Session,
}

impl VisionEmbedder {
    /// Load vision embedding model from ONNX file
    pub fn new(model_path: &Path) -> Result<Self, String> {
        log::info!("Loading vision embedding model from {:?}", model_path);

        let session = Session::builder()
            .map_err(|e| format!("Failed to create session builder: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load vision model: {}", e))?;

        // Log input/output info for debugging
        log::info!("Vision model inputs: {:?}", session.inputs);
        log::info!("Vision model outputs: {:?}", session.outputs);

        Ok(Self { session })
    }

    /// Embed a preprocessed image tensor
    /// Input: [1, 3, 224, 224] preprocessed image as ndarray
    /// Output: L2-normalized 768-dim embedding vector
    pub fn embed(&mut self, pixel_values: ndarray::Array4<f32>) -> Result<Array1<f32>, String> {
        // Capture output name BEFORE mutable borrow
        let output_name = self
            .session
            .outputs
            .first()
            .map(|o| o.name.clone())
            .unwrap_or_else(|| "last_hidden_state".to_string());

        // Create Tensor from ndarray
        let input_tensor = Tensor::from_array(pixel_values)
            .map_err(|e| format!("Failed to create input tensor: {}", e))?;

        // Run inference
        let outputs = self
            .session
            .run(ort::inputs!["pixel_values" => input_tensor])
            .map_err(|e| format!("Inference failed: {}", e))?;

        // Extract output as ndarray view
        let output = outputs
            .get(&output_name)
            .ok_or_else(|| format!("Output '{}' not found", output_name))?;
        
        let hidden = output
            .try_extract_array::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {}", e))?;

        let shape = hidden.shape().to_vec();
        log::debug!("Vision output shape: {:?}", shape);

        // Handle different output shapes and create owned array
        let embedding: Array1<f32> = if shape.len() == 3 {
            // [batch, seq_len, hidden_dim] - take CLS token at position 0
            let hidden_dim = shape[2];
            let mut cls_token = Array1::<f32>::zeros(hidden_dim);
            for i in 0..hidden_dim {
                cls_token[i] = hidden[[0, 0, i]];
            }
            cls_token
        } else if shape.len() == 2 {
            // [batch, hidden_dim] - already pooled
            let hidden_dim = shape[1];
            let mut emb = Array1::<f32>::zeros(hidden_dim);
            for i in 0..hidden_dim {
                emb[i] = hidden[[0, i]];
            }
            emb
        } else {
            return Err(format!("Unexpected output shape: {:?}", shape));
        };

        // L2 normalize
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm < 1e-12 {
            return Err("Zero-norm embedding".to_string());
        }

        Ok(embedding.mapv(|x| x / norm))
    }

    /// Get embedding dimension (should be 768)
    pub fn embedding_dim(&self) -> usize {
        768
    }
}
