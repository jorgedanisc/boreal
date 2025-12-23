// In-memory vector search with cosine similarity
// For small collections (< 100k), brute-force dot product is efficient

use ndarray::Array1;
use std::collections::HashMap;

pub struct EmbeddingIndex {
    /// Map of photo_id -> embedding vector
    embeddings: HashMap<String, Vec<f32>>,
}

impl EmbeddingIndex {
    pub fn new() -> Self {
        Self {
            embeddings: HashMap::new(),
        }
    }

    /// Insert or update an embedding
    pub fn insert(&mut self, id: String, embedding: Array1<f32>) {
        self.embeddings.insert(id, embedding.to_vec());
    }

    /// Insert from raw f32 vec
    pub fn insert_vec(&mut self, id: String, embedding: Vec<f32>) {
        self.embeddings.insert(id, embedding);
    }

    /// Remove an embedding
    pub fn remove(&mut self, id: &str) -> bool {
        self.embeddings.remove(id).is_some()
    }

    /// Check if ID exists
    pub fn contains(&self, id: &str) -> bool {
        self.embeddings.contains_key(id)
    }

    /// Search for top-k similar items
    /// Uses dot product (equivalent to cosine similarity for L2-normalized vectors)
    pub fn search(&self, query_embedding: &Array1<f32>, k: usize) -> Vec<(String, f32)> {
        let query = query_embedding.as_slice().unwrap();
        self.search_vec(query, k)
    }

    /// Search with raw slice
    pub fn search_vec(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        let mut scores: Vec<(String, f32)> = self
            .embeddings
            .iter()
            .map(|(id, emb)| {
                let score = dot_product(query, emb);
                (id.clone(), score)
            })
            .collect();

        // Sort by score descending
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores.truncate(k);
        scores
    }

    /// Get number of indexed items
    pub fn len(&self) -> usize {
        self.embeddings.len()
    }

    /// Check if index is empty
    pub fn is_empty(&self) -> bool {
        self.embeddings.is_empty()
    }

    /// Clear all embeddings
    pub fn clear(&mut self) {
        self.embeddings.clear();
    }

    /// Get all indexed IDs
    pub fn ids(&self) -> Vec<String> {
        self.embeddings.keys().cloned().collect()
    }
}

impl Default for EmbeddingIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute dot product of two vectors
#[inline]
fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_and_search() {
        let mut index = EmbeddingIndex::new();

        // Insert some test embeddings
        let emb1 = Array1::from_vec(vec![1.0, 0.0, 0.0]);
        let emb2 = Array1::from_vec(vec![0.0, 1.0, 0.0]);
        let emb3 = Array1::from_vec(vec![0.707, 0.707, 0.0]); // Similar to both

        index.insert("1".to_string(), emb1);
        index.insert("2".to_string(), emb2);
        index.insert("3".to_string(), emb3);

        // Search with query similar to emb1
        let query = Array1::from_vec(vec![0.9, 0.1, 0.0]);
        let results = index.search(&query, 2);

        assert_eq!(results.len(), 2);
        // First result should be most similar
        assert!(results[0].1 >= results[1].1);
    }

    #[test]
    fn test_remove() {
        let mut index = EmbeddingIndex::new();
        index.insert("1".to_string(), Array1::from_vec(vec![1.0, 0.0]));

        assert!(index.contains("1"));
        assert!(index.remove("1"));
        assert!(!index.contains("1"));
    }
}
