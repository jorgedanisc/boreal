/**
 * WebAssembly Embedding Service for Mobile
 * 
 * Uses onnxruntime-web to run nomic-embed-vision-v1.5 and nomic-embed-text-v1.5
 * locally in the browser via WebAssembly.
 */

import * as ort from 'onnxruntime-web';
import { invoke } from '@tauri-apps/api/core';

// Model URLs (HuggingFace)
const MODEL_BASE_URL = 'https://huggingface.co/nomic-ai';
const VISION_MODEL_URL = `${MODEL_BASE_URL}/nomic-embed-vision-v1.5/resolve/main/onnx/model.onnx`;
const TEXT_MODEL_URL = `${MODEL_BASE_URL}/nomic-embed-text-v1.5/resolve/main/onnx/model.onnx`;
const TOKENIZER_URL = `${MODEL_BASE_URL}/nomic-embed-text-v1.5/resolve/main/tokenizer.json`;

// CLIP normalization constants (from preprocessor_config.json)
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];
const TARGET_SIZE = 224;
const EMBEDDING_DIM = 768;
const LAYER_NORM_EPS = 1e-12;

// IndexedDB storage keys
const DB_NAME = 'boreal-models';
const DB_VERSION = 1;
const STORE_NAME = 'models';

export interface EmbeddingStatus {
  available: boolean;
  ready: boolean;
  indexed_count: number;
}

export interface SearchResult {
  id: string;
  score: number;
}

// In-memory vector index
const embeddingIndex = new Map<string, Float32Array>();

// Session instances
let visionSession: ort.InferenceSession | null = null;
let textSession: ort.InferenceSession | null = null;
let tokenizer: TokenizerData | null = null;

interface TokenizerData {
  vocab: Record<string, number>;
  added_tokens: Record<string, number>;
  unk_token_id: number;
  cls_token_id: number;
  sep_token_id: number;
  pad_token_id: number;
}

// ============================================================================
// IndexedDB Persistence
// ============================================================================

async function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getFromDB(key: string): Promise<ArrayBuffer | null> {
  const db = await openModelDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function saveToDB(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openModelDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(data, key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function hasAllModels(): Promise<boolean> {
  try {
    const [vision, text, tok] = await Promise.all([
      getFromDB('vision-model'),
      getFromDB('text-model'),
      getFromDB('tokenizer'),
    ]);
    return vision !== null && text !== null && tok !== null;
  } catch {
    return false;
  }
}

// ============================================================================
// Model Download
// ============================================================================

export async function downloadModels(
  onProgress?: (downloaded: number, total: number, label: string) => void
): Promise<void> {
  const downloads: Array<{ url: string; key: string; label: string }> = [
    { url: VISION_MODEL_URL, key: 'vision-model', label: 'Vision Model' },
    { url: TEXT_MODEL_URL, key: 'text-model', label: 'Text Model' },
    { url: TOKENIZER_URL, key: 'tokenizer', label: 'Tokenizer' },
  ];

  for (const { url, key, label } of downloads) {
    // Check if already cached
    const cached = await getFromDB(key);
    if (cached) {
      console.log(`[Embedding] ${label} already cached`);
      continue;
    }

    console.log(`[Embedding] Downloading ${label}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${label}: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      if (onProgress && total > 0) {
        onProgress(downloaded, total, label);
      }
    }

    // Combine chunks into single ArrayBuffer
    const combined = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    await saveToDB(key, combined.buffer);
    console.log(`[Embedding] ${label} cached (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
  }
}

let isInitializing = false;

// ============================================================================
// Model Initialization
// ============================================================================

export async function initModels(): Promise<void> {
  if (isReady()) {
    console.log('[Embedding] Models already initialized');
    return;
  }

  if (isInitializing) {
    console.log('[Embedding] Initialization already in progress...');
    // Wait for it to finish? Or just return and assume the other call will finish.
    // For simplicity, we just return. The state will update eventually.
    return;
  }

  isInitializing = true;

  try {
    // Configure ONNX Runtime WASM paths
    // IMPORTANT: Using version 1.20.1 to match package.json
    // Disabling multi-threading and SIMD for broader compatibility initially
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = 1;

    // Load models from IndexedDB
    const [visionData, textData, tokenizerData] = await Promise.all([
      getFromDB('vision-model'),
      getFromDB('text-model'),
      getFromDB('tokenizer'),
    ]);

    if (!visionData || !textData || !tokenizerData) {
      throw new Error('Models not downloaded. Call downloadModels() first.');
    }

    console.log('[Embedding] Loading vision model...');
    // Force WASM execution provider to ensure no automatic selection mess up
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    };

    visionSession = await ort.InferenceSession.create(new Uint8Array(visionData), sessionOptions);

    console.log('[Embedding] Loading text model...');
    textSession = await ort.InferenceSession.create(new Uint8Array(textData), sessionOptions);

    console.log('[Embedding] Loading tokenizer...');
    const tokenizerJson = JSON.parse(new TextDecoder().decode(tokenizerData));
    tokenizer = parseTokenizer(tokenizerJson);

    // Load existing embeddings from DB
    await loadPersistedEmbeddings();

    console.log('[Embedding] All models initialized');
  } finally {
    isInitializing = false;
  }
}

function parseTokenizer(json: unknown): TokenizerData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = json as any;

  // Build vocab from model
  const vocab: Record<string, number> = {};
  if (data.model?.vocab) {
    Object.assign(vocab, data.model.vocab);
  }

  // Added tokens
  const added_tokens: Record<string, number> = {};
  if (Array.isArray(data.added_tokens)) {
    for (const token of data.added_tokens) {
      added_tokens[token.content] = token.id;
    }
  }

  return {
    vocab,
    added_tokens,
    unk_token_id: added_tokens['[UNK]'] ?? 0,
    cls_token_id: added_tokens['[CLS]'] ?? 101,
    sep_token_id: added_tokens['[SEP]'] ?? 102,
    pad_token_id: added_tokens['[PAD]'] ?? 0,
  };
}

// ============================================================================
// Image Preprocessing (CLIP-style)
// ============================================================================

export async function preprocessImage(imageData: ImageData | HTMLImageElement | string): Promise<ort.Tensor> {
  let img: HTMLImageElement;

  if (typeof imageData === 'string') {
    // Base64 or URL
    img = await loadImage(imageData);
  } else if (imageData instanceof HTMLImageElement) {
    img = imageData;
  } else {
    // ImageData - convert to canvas then image
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    img = await loadImage(canvas.toDataURL());
  }

  // Resize shortest side to 224, then center crop
  const { width, height } = img;
  let newWidth: number, newHeight: number;

  if (width < height) {
    newWidth = TARGET_SIZE;
    newHeight = Math.round((TARGET_SIZE * height) / width);
  } else {
    newHeight = TARGET_SIZE;
    newWidth = Math.round((TARGET_SIZE * width) / height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Draw with center crop
  const sx = (newWidth - TARGET_SIZE) / 2;
  const sy = (newHeight - TARGET_SIZE) / 2;

  // First resize to intermediate size
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = newWidth;
  tempCanvas.height = newHeight;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.drawImage(img, 0, 0, newWidth, newHeight);

  // Then crop to target
  ctx.drawImage(tempCanvas, sx, sy, TARGET_SIZE, TARGET_SIZE, 0, 0, TARGET_SIZE, TARGET_SIZE);

  const imageDataResult = ctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE);
  const { data } = imageDataResult;

  // Convert to CHW tensor with CLIP normalization
  const tensorData = new Float32Array(3 * TARGET_SIZE * TARGET_SIZE);

  for (let y = 0; y < TARGET_SIZE; y++) {
    for (let x = 0; x < TARGET_SIZE; x++) {
      const srcIdx = (y * TARGET_SIZE + x) * 4;
      for (let c = 0; c < 3; c++) {
        const value = data[srcIdx + c] / 255.0;
        const normalized = (value - CLIP_MEAN[c]) / CLIP_STD[c];
        tensorData[c * TARGET_SIZE * TARGET_SIZE + y * TARGET_SIZE + x] = normalized;
      }
    }
  }

  return new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE]);
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ============================================================================
// Text Tokenization (Simple BERT-style)
// ============================================================================

function tokenize(text: string): { inputIds: BigInt64Array; attentionMask: BigInt64Array; tokenTypeIds: BigInt64Array } {
  if (!tokenizer) throw new Error('Tokenizer not loaded');

  // Simple whitespace + basic tokenization
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  const ids: number[] = [tokenizer.cls_token_id];

  for (const token of tokens) {
    const id = tokenizer.vocab[token] ??
      tokenizer.added_tokens[token] ??
      tokenizer.unk_token_id;
    ids.push(id);
  }

  ids.push(tokenizer.sep_token_id);

  const seqLen = ids.length;
  const inputIds = new BigInt64Array(seqLen);
  const attentionMask = new BigInt64Array(seqLen);
  const tokenTypeIds = new BigInt64Array(seqLen);

  for (let i = 0; i < seqLen; i++) {
    inputIds[i] = BigInt(ids[i]);
    attentionMask[i] = 1n;
    tokenTypeIds[i] = 0n;
  }

  return { inputIds, attentionMask, tokenTypeIds };
}

// ============================================================================
// Embedding Inference
// ============================================================================

export async function embedImage(imageSource: string): Promise<Float32Array> {
  if (!visionSession) throw new Error('Vision model not initialized');

  const inputTensor = await preprocessImage(imageSource);

  const results = await visionSession.run({
    'pixel_values': inputTensor,
  });

  const output = results[Object.keys(results)[0]];
  const data = output.data as Float32Array;

  // Extract CLS token (first position) if 3D, otherwise use directly
  const dims = output.dims;
  let embedding: Float32Array;

  if (dims.length === 3) {
    // [batch, seq_len, hidden_dim] - take CLS token
    const hiddenDim = dims[2] as number;
    embedding = new Float32Array(data.slice(0, hiddenDim));
  } else {
    embedding = new Float32Array(data.slice(0, EMBEDDING_DIM));
  }

  // L2 normalize
  return l2Normalize(embedding);
}

export async function embedQuery(query: string): Promise<Float32Array> {
  if (!textSession || !tokenizer) throw new Error('Text model not initialized');

  // Add search_query prefix for multimodal search
  const prefixed = `search_query: ${query}`;
  const { inputIds, attentionMask, tokenTypeIds } = tokenize(prefixed);
  const seqLen = inputIds.length;

  const results = await textSession.run({
    'input_ids': new ort.Tensor('int64', inputIds, [1, seqLen]),
    'attention_mask': new ort.Tensor('int64', attentionMask, [1, seqLen]),
    'token_type_ids': new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
  });

  const output = results[Object.keys(results)[0]];
  const data = output.data as Float32Array;
  const dims = output.dims;

  let embedding: Float32Array;

  if (dims.length === 3) {
    // Mean pooling over sequence
    const hiddenDim = dims[2] as number;
    embedding = meanPooling(data, seqLen, hiddenDim);
  } else {
    embedding = new Float32Array(data.slice(0, EMBEDDING_DIM));
  }

  // Layer norm then L2 normalize
  embedding = layerNorm(embedding);
  return l2Normalize(embedding);
}

function meanPooling(data: Float32Array, seqLen: number, hiddenDim: number): Float32Array {
  const pooled = new Float32Array(hiddenDim);

  for (let i = 0; i < seqLen; i++) {
    for (let j = 0; j < hiddenDim; j++) {
      pooled[j] += data[i * hiddenDim + j];
    }
  }

  for (let j = 0; j < hiddenDim; j++) {
    pooled[j] /= seqLen;
  }

  return pooled;
}

function layerNorm(x: Float32Array): Float32Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = x[i] - mean;
    variance += diff * diff;
  }
  variance /= n;

  const result = new Float32Array(n);
  const std = Math.sqrt(variance + LAYER_NORM_EPS);
  for (let i = 0; i < n; i++) {
    result[i] = (x[i] - mean) / std;
  }

  return result;
}

function l2Normalize(x: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < x.length; i++) {
    norm += x[i] * x[i];
  }
  norm = Math.sqrt(norm);

  if (norm < 1e-12) throw new Error('Zero-norm embedding');

  const result = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    result[i] = x[i] / norm;
  }

  return result;
}

// ============================================================================
// Vector Index & Search
// ============================================================================

export async function addToIndex(photoId: string, embedding: Float32Array, vaultId: string): Promise<void> {
  // Update in-memory index
  embeddingIndex.set(photoId, embedding);

  // Persist to Rust DB
  try {
    await invoke('save_embedding', {
      photoId,
      vaultId,
      embedding: Array.from(embedding)
    });
  } catch (e) {
    console.warn('[Embedding] Failed to persist embedding:', e);
  }
}

export function removeFromIndex(photoId: string): boolean {
  return embeddingIndex.delete(photoId);
}

export function isInIndex(photoId: string): boolean {
  return embeddingIndex.has(photoId);
}

export function getIndexCount(): number {
  return embeddingIndex.size;
}

export function clearIndex(): void {
  embeddingIndex.clear();
}

export async function search(query: string, topK: number, minScore = 0.0525): Promise<SearchResult[]> {
  console.debug(`[Embedding] Searching for "${query}" (minScore: ${minScore})`);
  const queryEmbedding = await embedQuery(query);

  // Debug query embedding stats
  let qSum = 0;
  for (let i = 0; i < queryEmbedding.length; i++) qSum += queryEmbedding[i];
  console.debug(`[Embedding] Query vector stats: dim=${queryEmbedding.length}, sum=${qSum.toFixed(4)}, first5=[${queryEmbedding.slice(0, 5).join(',')}]`);

  const scores: SearchResult[] = [];
  let maxScore = -1;
  let minScoreSeen = 1;

  for (const [id, embedding] of embeddingIndex) {
    const score = dotProduct(queryEmbedding, embedding);

    if (score > maxScore) maxScore = score;
    if (score < minScoreSeen) minScoreSeen = score;

    if (score >= minScore) {
      scores.push({ id, score });
    }
  }

  console.debug(`[Embedding] Scored ${embeddingIndex.size} items. Max: ${maxScore.toFixed(4)}, Min: ${minScoreSeen.toFixed(4)}. Found ${scores.length} matches >= ${minScore}`);

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topK);
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// ============================================================================
// Status & State Management
// ============================================================================

export async function getStatus(): Promise<EmbeddingStatus> {
  const hasModels = await hasAllModels();
  const isReady = visionSession !== null && textSession !== null && tokenizer !== null;

  return {
    available: hasModels,
    ready: isReady,
    indexed_count: embeddingIndex.size,
  };
}

export function isReady(): boolean {
  return visionSession !== null && textSession !== null && tokenizer !== null;
}

// Load existing embeddings from DB on startup
export async function loadPersistedEmbeddings(): Promise<void> {
  try {
    const persisted = await invoke<[string, number[]][]>('load_embeddings');
    if (persisted && persisted.length > 0) {
      console.log(`[Embedding] Loaded ${persisted.length} persisted embeddings`);
      for (const [id, vector] of persisted) {
        embeddingIndex.set(id, new Float32Array(vector));
      }
    }
  } catch (e) {
    // If DB is not ready (e.g. race condition on startup), just warn
    const errorMsg = String(e);
    if (errorMsg.includes('Database not initialized')) {
      console.warn('[Embedding] DB not ready yet, skipped loading persisted embeddings.');
    } else {
      console.error('[Embedding] Failed to load persisted embeddings:', e);
    }
  }
}
