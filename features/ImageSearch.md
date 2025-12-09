Image Search

- done using metadata as default
- if ai processing model downloaded, then use it first, then metadata


# AI Model and Processing

- Use https://huggingface.co/google/siglip2-so400m-patch14-384
- Cache all embeddings on disk; do *not* recompute on every search.

For a Tauri app, the industry standard solution is ONNX Runtime.
- Format: Convert the model to ONNX.
- Quantization: Apply Int8 Dynamic Quantization (reduces size from ~1.6GB to ~400MB).
- Inference Engine: Use the Rust crate `ort`.


# Identity Layer (shared SigLIP‑2 embeddings)

### 1. Data model

- [ ] Add `Identity` structure in backend:
  - `id: IdentityId`
  - `name: String` (e.g. `"Steve"`)
  - `embedding: Vec<f32>` (L2‑normalized, same dim as image embeddings)
  - `image_ids: Vec<ImageId>` (images used to define this identity)
- [ ] Persist identities (SQLite / JSON / whatever you already use for metadata).

---

### 2. Creating / updating an identity

- [ ] Backend fn: `create_or_update_identity(name, image_ids)`:
  - [ ] For each `image_id`, load its **precomputed** image embedding.
  - [ ] Compute mean vector: `mean_vec = avg(embeddings)`.
  - [ ] L2‑normalize: `id_vec = mean_vec / ||mean_vec||`.
  - [ ] Upsert into `identities` table: store `name`, `id_vec`, and `image_ids`.
- [ ] Expose Tauri command / API:
  - `tauri::command async fn tag_identity(name: String, image_ids: Vec<ImageId>)`.

- [ ] Frontend:
  - [ ] UI to select one or more images and enter a name (“Steve”) → calls `tag_identity`.

---

### 3. Search with optional identity

- [ ] Extend search API to accept an optional identity name:

  ```rust
  struct SearchRequest {
      query_text: String,
      top_k: usize,
      identity_name: Option<String>, // e.g. Some("Steve")
  }
  ```

- [ ] Core flow:
  1. [ ] `text_vec = embed_text(query_text)` (normalize).
  2. [ ] Query semantic ANN index with `text_vec` → top `N` candidates (e.g. `N = 200`), returning `(image_id, image_embedding, sem_score)`.
  3. [ ] If `identity_name` is `Some(name)`:
     - [ ] Look up `id_vec` for that identity.
     - [ ] For each candidate:
       - `score_sem = cos(text_vec, image_embedding)`
       - `score_id  = cos(id_vec, image_embedding)`
       - `final_score = α * score_sem + (1.0 - α) * score_id`
       - Start with `α ≈ 0.6–0.8`, tune later.
     - [ ] Re-rank candidates by `final_score`.
  4. [ ] Return top `top_k` after re‑ranking.

- [ ] If `identity_name` is `None`, just return the semantic ANN results as usual.

---

### 4. Identity‑only search (optional nice‑to‑have)

- [ ] Add API: `search_by_identity(name, top_k)`:
  - [ ] Load `id_vec`.
  - [ ] Query *all* images by `cos(id_vec, image_embedding)` (via:
    - full scan if smallish dataset, or
    - same ANN index using `id_vec` as a query vector).
- [ ] Frontend: show a simple “Show all photos of Steve” button.

