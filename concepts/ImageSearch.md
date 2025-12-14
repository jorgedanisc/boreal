# Image Search

## Overview

Boreal uses local AI to understand your photos. All processing happens on your device.

**Capabilities:**
- Natural language search: "dog playing in snow"
- Identity search: "photos of Steve"
- Hybrid search: "Steve at the beach"
- Metadata search: dates, locations, camera

---

## How It Works

### Embeddings

When you import photos, Boreal generates a 768-dimensional vector for each image. This vector captures semantic meaning—what's in the photo, the scene, the mood.

Embeddings are cached in your local database. They're computed once per image, never recomputed unless you delete the cache.

### Text Search

When you search for "dog playing in snow":

1. Your query is converted to a vector
2. Find images whose vectors are most similar (cosine similarity)
3. Results ranked by similarity score

### Identity Search

Identities are people you've tagged. When you tag someone:

1. Select 3-5 photos of that person
2. Boreal averages their embeddings into a single "identity vector"
3. That vector is stored with the person's name

When searching "photos of Steve":

1. Look up Steve's identity vector
2. Find images similar to that vector
3. Rank by similarity

### Hybrid Search

When searching "Steve at the beach":

1. Generate text embedding for "at the beach"
2. Look up Steve's identity vector
3. Score each image: `α × text_similarity + (1-α) × identity_similarity`
4. Rank by combined score (α defaults to 0.7)

---

## Model

**Model**: [SigLIP2-so400m-patch14-384](https://huggingface.co/google/siglip2-so400m-patch14-384)

**Quantization**: Int8 dynamic quantization (~400MB)

**Inference**: ONNX Runtime via the `ort` Rust crate

The model downloads on first use. Without it, search falls back to metadata only.

---

## Tips

### For Better Identity Recognition

Select photos where:
- Face is clearly visible and reasonably large
- Person is the main subject
- Include variety: different lighting, angles, expressions
- 3-5 photos per person is usually enough

### For Better Search Results

- Be descriptive: "golden retriever on beach" better than "dog"
- Include context: "birthday party with cake" better than "party"
- Try variations if first search doesn't work

---

## Data Model

```sql
-- Image embeddings (generated on import)
CREATE TABLE embeddings (
    file_id TEXT PRIMARY KEY,
    vector BLOB,  -- 768 × float32 = 3KB
    model_version TEXT
);

-- Identities (user-created)
CREATE TABLE identities (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    vector BLOB,
    source_file_ids TEXT  -- JSON array
);