// Text embedding using nomic-embed-text-v1.5 ONNX model
// Uses HuggingFace tokenizer, mean pooling, layer norm, and L2 normalization

use ndarray::{Array1, Array2};
use ort::{session::Session, value::Tensor};
use std::path::Path;
use tokenizers::Tokenizer;

// Layer norm epsilon from model config
const LAYER_NORM_EPS: f32 = 1e-12;

pub struct TextEmbedder {
    session: Session,
    tokenizer: Tokenizer,
}

impl TextEmbedder {
    /// Load text embedding model and tokenizer from files
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> Result<Self, String> {
        log::info!("Loading text embedding model from {:?}", model_path);
        log::info!("Loading tokenizer from {:?}", tokenizer_path);

        let session = Session::builder()
            .map_err(|e| format!("Failed to create session builder: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load text model: {}", e))?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        // Log input/output info for debugging
        log::info!("Text model inputs: {:?}", session.inputs);
        log::info!("Text model outputs: {:?}", session.outputs);

        Ok(Self { session, tokenizer })
    }

    /// Embed a search query with "search_query: " prefix
    /// For multimodal search, use this to embed user queries
    pub fn embed_query(&mut self, query: &str) -> Result<Array1<f32>, String> {
        let prefixed = format!("search_query: {}", query);
        self.embed_text(&prefixed)
    }

    /// Embed text without prefix (for general use)
    pub fn embed_text(&mut self, text: &str) -> Result<Array1<f32>, String> {
        // Capture output name BEFORE mutable borrow
        let output_name = self
            .session
            .outputs
            .first()
            .map(|o| o.name.clone())
            .unwrap_or_else(|| "last_hidden_state".to_string());

        // Tokenize
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("Tokenization failed: {}", e))?;

        let ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
        let attention: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&x| x as i64)
            .collect();
        let seq_len = ids.len();

        log::debug!("Tokenized to {} tokens", seq_len);

        // Create input arrays
        let input_ids = Array2::from_shape_vec((1, seq_len), ids)
            .map_err(|e| format!("Failed to create input_ids array: {}", e))?;
        let attention_mask = Array2::from_shape_vec((1, seq_len), attention)
            .map_err(|e| format!("Failed to create attention_mask array: {}", e))?;
        // token_type_ids: all zeros for single-sentence input
        let token_type_ids = Array2::<i64>::zeros((1, seq_len));

        // Create Tensors from ndarray
        let input_ids_tensor = Tensor::from_array(input_ids.clone())
            .map_err(|e| format!("Failed to create input_ids tensor: {}", e))?;
        let attention_mask_tensor = Tensor::from_array(attention_mask.clone())
            .map_err(|e| format!("Failed to create attention_mask tensor: {}", e))?;
        let token_type_ids_tensor = Tensor::from_array(token_type_ids)
            .map_err(|e| format!("Failed to create token_type_ids tensor: {}", e))?;

        // Run inference
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "token_type_ids" => token_type_ids_tensor,
                "attention_mask" => attention_mask_tensor
            ])
            .map_err(|e| format!("Inference failed: {}", e))?;

        // Extract output as ndarray view
        let output = outputs
            .get(&output_name)
            .ok_or_else(|| format!("Output '{}' not found", output_name))?;
        
        let hidden = output
            .try_extract_array::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {}", e))?;

        let shape = hidden.shape().to_vec();
        log::debug!("Text output shape: {:?}", shape);

        // Mean pooling with attention mask
        let hidden_dim = if shape.len() == 3 {
            shape[2]
        } else if shape.len() == 2 {
            // Already pooled - copy to owned array
            let mut emb = Array1::<f32>::zeros(shape[1]);
            for i in 0..shape[1] {
                emb[i] = hidden[[0, i]];
            }
            return Self::normalize_static(emb);
        } else {
            return Err(format!("Unexpected output shape: {:?}", shape));
        };

        let attention_f32 = attention_mask.mapv(|x| x as f32);
        let embedding = Self::mean_pooling(&hidden, &attention_f32, seq_len, hidden_dim)?;

        // Layer norm + L2 normalize
        Self::normalize_static(embedding)
    }

    fn normalize_static(embedding: Array1<f32>) -> Result<Array1<f32>, String> {
        // Layer norm
        let ln = layer_norm(&embedding);

        // L2 normalize
        let norm: f32 = ln.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm < 1e-12 {
            return Err("Zero-norm embedding".to_string());
        }

        Ok(ln.mapv(|x| x / norm))
    }

    /// Mean pooling over token embeddings using attention mask
    fn mean_pooling(
        hidden: &ndarray::ArrayViewD<f32>,
        attention_mask: &Array2<f32>,
        seq_len: usize,
        hidden_dim: usize,
    ) -> Result<Array1<f32>, String> {
        let mut pooled = Array1::<f32>::zeros(hidden_dim);
        let mut total_weight = 0.0f32;

        for i in 0..seq_len {
            let weight = attention_mask[[0, i]];
            total_weight += weight;
            for j in 0..hidden_dim {
                pooled[j] += hidden[[0, i, j]] * weight;
            }
        }

        // Avoid division by zero
        let divisor = total_weight.max(1e-9);
        Ok(pooled.mapv(|x| x / divisor))
    }


}

/// Layer normalization with epsilon 1e-12 (from model config)
fn layer_norm(x: &Array1<f32>) -> Array1<f32> {
    let n = x.len() as f32;
    let mean = x.iter().sum::<f32>() / n;
    let var = x.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n;
    x.mapv(|v| (v - mean) / (var + LAYER_NORM_EPS).sqrt())
}
