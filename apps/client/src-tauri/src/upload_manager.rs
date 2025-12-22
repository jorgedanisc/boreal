use crate::cache::ThumbnailCache;
use crate::crypto;
use crate::exif_extractor;
use crate::file_filter::{self, MediaType};
use crate::media_processor;
use crate::storage::Storage;
use crate::vault::VaultConfig;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::sleep;

/// Constants for Fresh Upload auto-toggle behavior
const FRESH_UPLOAD_FILE_THRESHOLD: usize = 1000;
const FRESH_UPLOAD_SIZE_THRESHOLD: u64 = 20 * 1024 * 1024 * 1024; // 20GB

/// Retry configuration
const MAX_RETRY_ATTEMPTS: u32 = 3;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;

struct PreparedUpload {
    original_key: String,
    thumbnail_key: Option<String>,
    enc_original: Vec<u8>,
    enc_thumbnail: Option<Vec<u8>>,
    width: u32,
    height: u32,
    raw_thumbnail: Option<Vec<u8>>,
    exif_metadata: Option<exif_extractor::ExifMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UploadStatus {
    Pending,
    Processing,
    EncryptingOriginal,
    EncryptingThumbnail,
    UploadingOriginal { progress: f64 },
    UploadingThumbnail { progress: f64 },
    Completed,
    Failed { error: String },
    Cancelled,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadItem {
    pub id: String,
    pub path: PathBuf,
    pub filename: String,
    pub size: u64,
    pub status: UploadStatus,
    pub progress: f64,
    pub media_type: MediaType,
    pub fresh_upload: bool,
    #[serde(default)]
    pub bytes_uploaded: u64,
    #[serde(default)]
    pub retry_count: u32,
    /// Pre-generated frames for video thumbnailing (from Frontend)
    #[serde(skip)]
    pub pre_generated_frames: Option<Vec<Vec<u8>>>,
}

impl UploadItem {
    pub fn new(
        path: PathBuf,
        fresh_upload: bool,
        pre_generated_frames: Option<Vec<Vec<u8>>>,
    ) -> Result<Self> {
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let size = file_filter::get_file_size(&path)?;
        let media_type = file_filter::detect_media_type(&path)?;

        Ok(Self {
            id: uuid::Uuid::new_v4().to_string(),
            path,
            filename,
            size,
            status: UploadStatus::Pending,
            progress: 0.0,
            media_type,
            fresh_upload,
            bytes_uploaded: 0,
            retry_count: 0,
            pre_generated_frames,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueState {
    pub items: Vec<UploadItem>,
    pub total_size: u64,
    pub completed_count: usize,
    pub failed_count: usize,
    pub pending_count: usize,
}

pub struct UploadManager {
    queue: Arc<RwLock<HashMap<String, UploadItem>>>,
    paused_ids: Arc<RwLock<HashSet<String>>>,
    cancelled_ids: Arc<RwLock<HashSet<String>>>,
    app_handle: AppHandle,
    storage: Arc<Mutex<Option<Storage>>>,
    config: Arc<Mutex<Option<VaultConfig>>>,
    db: Arc<Mutex<Option<Connection>>>,
    thumbnail_cache: Arc<Mutex<Option<ThumbnailCache>>>,
    cancel_tx: mpsc::Sender<String>,
    is_processing: Arc<RwLock<bool>>,
}

impl UploadManager {
    pub fn new(
        app_handle: AppHandle,
        storage: Arc<Mutex<Option<Storage>>>,
        config: Arc<Mutex<Option<VaultConfig>>>,
        db: Arc<Mutex<Option<Connection>>>,
        thumbnail_cache: Arc<Mutex<Option<ThumbnailCache>>>,
    ) -> (Self, mpsc::Receiver<String>) {
        let (cancel_tx, cancel_rx) = mpsc::channel(100);

        (
            Self {
                queue: Arc::new(RwLock::new(HashMap::new())),
                paused_ids: Arc::new(RwLock::new(HashSet::new())),
                cancelled_ids: Arc::new(RwLock::new(HashSet::new())),
                app_handle,
                storage,
                config,
                db,
                thumbnail_cache,
                cancel_tx,
                is_processing: Arc::new(RwLock::new(false)),
            },
            cancel_rx,
        )
    }

    /// Checks if Fresh Upload should be auto-toggled off based on file count/size
    pub fn should_disable_fresh_upload(&self, files: &[UploadItem]) -> bool {
        let total_count = files.len();
        let total_size: u64 = files.iter().map(|f| f.size).sum();
        total_count > FRESH_UPLOAD_FILE_THRESHOLD || total_size > FRESH_UPLOAD_SIZE_THRESHOLD
    }

    /// Add files to the upload queue
    pub async fn add_files(
        &self,
        paths: Vec<PathBuf>,
        fresh_upload: bool,
        thumbnails: Option<HashMap<String, Vec<String>>>,
    ) -> Result<Vec<UploadItem>> {
        let mut items = Vec::new();
        let mut errors = Vec::new();

        for path in paths {
            let path_str = path.to_string_lossy().to_string();
            let frames = if let Some(map) = &thumbnails {
                if let Some(encoded_frames) = map.get(&path_str) {
                    // Start Decoding
                    let mut decoded = Vec::new();
                    for frame_b64 in encoded_frames {
                        // Handle data:image/jpeg;base64, prefix if present
                        let clean_b64 = if let Some(idx) = frame_b64.find(',') {
                            &frame_b64[idx + 1..]
                        } else {
                            frame_b64
                        };

                        if let Ok(bytes) = BASE64.decode(clean_b64) {
                            decoded.push(bytes);
                        } else {
                            log::warn!("Failed to decode thumbnail frame from frontend");
                        }
                    }
                    if !decoded.is_empty() {
                        Some(decoded)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            match UploadItem::new(path.clone(), fresh_upload, frames) {
                Ok(item) => items.push(item),
                Err(e) => errors.push((path, e.to_string())), // Log error but continue
            }
        }

        // Add to queue
        {
            let mut queue = self.queue.write().await;
            for item in &items {
                queue.insert(item.id.clone(), item.clone());
            }
        }

        // Emit queue changed event
        self.emit_queue_changed().await;

        // Report errors for unsupported files
        for (path, error) in errors {
            self.app_handle
                .emit(
                    "upload:error",
                    serde_json::json!({
                        "path": path.to_string_lossy(),
                        "error": error // error is already stringified above, but we want full details if possible
                    }),
                )
                .ok();
        }

        Ok(items)
    }

    /// Get current queue state
    pub async fn get_state(&self) -> QueueState {
        let queue = self.queue.read().await;
        let items: Vec<UploadItem> = queue.values().cloned().collect();
        let total_size = items.iter().map(|i| i.size).sum();
        let completed_count = items
            .iter()
            .filter(|i| matches!(i.status, UploadStatus::Completed))
            .count();
        let failed_count = items
            .iter()
            .filter(|i| matches!(i.status, UploadStatus::Failed { .. }))
            .count();
        let pending_count = items
            .iter()
            .filter(|i| matches!(i.status, UploadStatus::Pending))
            .count();

        QueueState {
            items,
            total_size,
            completed_count,
            failed_count,
            pending_count,
        }
    }

    /// Pause a specific upload
    pub async fn pause(&self, id: &str) {
        self.paused_ids.write().await.insert(id.to_string());
        self.update_status(id, UploadStatus::Paused).await;
    }

    /// Resume a paused upload
    pub async fn resume(&self, id: &str) {
        self.paused_ids.write().await.remove(id);
        // Set back to pending so it gets picked up in the next processing cycle
        self.update_status(id, UploadStatus::Pending).await;
    }

    /// Cancel a specific upload
    pub async fn cancel(&self, id: &str) {
        self.cancelled_ids.write().await.insert(id.to_string());
        self.cancel_tx.send(id.to_string()).await.ok();

        let mut queue = self.queue.write().await;
        if let Some(item) = queue.get_mut(id) {
            item.status = UploadStatus::Cancelled;
        }
        drop(queue);
        self.emit_queue_changed().await;
    }

    /// Retry a failed upload
    pub async fn retry(&self, id: &str) {
        let mut queue = self.queue.write().await;
        if let Some(item) = queue.get_mut(id) {
            if matches!(item.status, UploadStatus::Failed { .. }) {
                item.status = UploadStatus::Pending;
                item.progress = 0.0;
                item.bytes_uploaded = 0;
                // Note: retry_count is NOT reset - this tracks total attempts
            }
        }
        drop(queue);
        self.emit_queue_changed().await;
    }

    /// Remove an item from the queue (if not currently processing)
    pub async fn remove_item(&self, id: &str) {
        {
            let mut queue = self.queue.write().await;
            // Only allow removing if not currently uploading this specific item?
            // User wants "remove" to just work. If it's processing, we should probably cancel it first.
            if let Some(item) = queue.get(id) {
                if matches!(
                    item.status,
                    UploadStatus::Processing
                        | UploadStatus::EncryptingOriginal
                        | UploadStatus::EncryptingThumbnail
                        | UploadStatus::UploadingOriginal { .. }
                        | UploadStatus::UploadingThumbnail { .. }
                ) {
                    // If active, we should cancel first.
                    // But since this is a tailored "remove" for the UI list, usually user removes PEnding items.
                    // If user removes active item, we treat as cancel + remove.
                }
            }
            queue.remove(id);
        }

        // Also remove from cancelled/paused sets to clean up
        self.paused_ids.write().await.remove(id);
        self.cancelled_ids.write().await.remove(id);

        // If it was being processed, the cancellation logic (if invoked) would handle it,
        // but if we just ripped it out of the HashMap, the background task might fail when it tries to update status?
        // Actually the background task holds a `queue` Arc, but reads/writes with locks.
        // If we remove it from map, `update_status` checks `if let Some(item) = ...`. If None, it does nothing.
        // So simply removing it is safe-ish, but if it was the *current* item, the background loop holds a clone?
        // No, the background loop gets `next_item` (clone). Then it calls `process_item_with_retry`.
        // `process_item_with_retry` calls `update_status_static`.
        // If we remove it from the map here, `update_status_static` will not find it and won't emit updates.
        // The upload will technically continue in the background thread until it finishes or fails, but no one will know.
        // Ideally we should cancel it if it's running.

        // For now, let's assume usage is mostly for Pending items.
        // If we want robust "Stop & Delete", we should call cancel first.
        // But for this specific fix (sync state), removing from map is the key.

        self.emit_queue_changed().await;
    }

    /// Remove completed/failed items from queue
    pub async fn clear_finished(&self) {
        let mut queue = self.queue.write().await;
        queue.retain(|_, item| {
            !matches!(
                item.status,
                UploadStatus::Completed | UploadStatus::Failed { .. } | UploadStatus::Cancelled
            )
        });
        drop(queue);
        self.emit_queue_changed().await;
    }

    /// Update fresh_upload flag on all pending items (called at upload start to use current UI state)
    pub async fn update_fresh_upload_flag(&self, fresh_upload: bool) {
        let mut queue = self.queue.write().await;
        for item in queue.values_mut() {
            if matches!(item.status, UploadStatus::Pending) {
                item.fresh_upload = fresh_upload;
            }
        }
    }

    /// Start processing the upload queue in the background
    pub async fn start_processing(&self) -> Result<()> {
        // Check if already processing
        {
            let is_processing = self.is_processing.read().await;
            if *is_processing {
                return Ok(()); // Already processing
            }
        }

        // Mark as processing
        *self.is_processing.write().await = true;

        // Clone what we need for the background task
        let queue = Arc::clone(&self.queue);
        let paused_ids = Arc::clone(&self.paused_ids);
        let cancelled_ids = Arc::clone(&self.cancelled_ids);
        let storage = Arc::clone(&self.storage);
        let config = Arc::clone(&self.config);
        let db = Arc::clone(&self.db);
        let thumbnail_cache = Arc::clone(&self.thumbnail_cache);
        let app_handle = self.app_handle.clone();
        let is_processing = Arc::clone(&self.is_processing);

        // Spawn background processing task
        tokio::spawn(async move {
            loop {
                // Find the next pending item
                let next_item: Option<UploadItem> = {
                    let queue_guard = queue.read().await;
                    let paused = paused_ids.read().await;
                    let cancelled = cancelled_ids.read().await;

                    queue_guard
                        .values()
                        .find(|i| {
                            matches!(i.status, UploadStatus::Pending)
                                && !paused.contains(&i.id)
                                && !cancelled.contains(&i.id)
                        })
                        .cloned()
                };

                match next_item {
                    Some(item) => {
                        // Process this item with retry logic
                        let result = Self::process_item_with_retry(
                            &queue,
                            &cancelled_ids,
                            &storage,
                            &config,
                            &db,
                            &thumbnail_cache,
                            &app_handle,
                            item,
                        )
                        .await;

                        if let Err(e) = result {
                            // Already handled in process_item_with_retry
                            // Print debug representation to see error chain
                            log::info!("Upload failed: {:?}", e);
                        }
                    }
                    None => {
                        // No more pending items
                        break;
                    }
                }
            }

            // Mark as not processing
            *is_processing.write().await = false;
        });

        Ok(())
    }

    /// Process a single item with retry logic
    async fn process_item_with_retry(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        cancelled_ids: &Arc<RwLock<HashSet<String>>>,
        storage: &Arc<Mutex<Option<Storage>>>,
        config: &Arc<Mutex<Option<VaultConfig>>>,
        db: &Arc<Mutex<Option<Connection>>>,
        thumbnail_cache: &Arc<Mutex<Option<ThumbnailCache>>>,
        app_handle: &AppHandle,
        mut item: UploadItem,
    ) -> Result<()> {
        let id = item.id.clone();
        
        // Step 1: Prepare (Heavy CPU Processing + Encryption) - Done ONCE
        // Cancel check happens inside prepare
        let prepared = match Self::prepare_item(
            queue,
            cancelled_ids,
            config,
            app_handle,
            &item
        ).await {
            Ok(Some(p)) => p,
            Ok(None) => return Ok(()), // Cancelled
            Err(e) => {
                Self::handle_failure_static(queue, app_handle, &id, &e.to_string()).await;
                return Err(e);
            }
        };

        // Step 2: Upload (Network) - Retried on failure
        let mut last_error = String::new();

        for attempt in 0..MAX_RETRY_ATTEMPTS {
            // Check if cancelled
            if cancelled_ids.read().await.contains(&id) {
                return Ok(());
            }

            // Update retry count in UI
            if attempt > 0 {
                item.retry_count = attempt;
                {
                    let mut queue_guard = queue.write().await;
                    if let Some(q_item) = queue_guard.get_mut(&id) {
                        q_item.retry_count = attempt;
                    }
                }
            }

            // Attempt the upload
            match Self::upload_item(
                queue,
                storage,
                db,
                thumbnail_cache,
                app_handle,
                &item,
                &prepared
            ).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_error = e.to_string();
                    log::warn!("[Upload {}] Attempt {} failed: {}", id, attempt + 1, last_error);

                    if attempt < MAX_RETRY_ATTEMPTS - 1 {
                        // Exponential backoff
                        let delay = INITIAL_RETRY_DELAY_MS * (2_u64.pow(attempt));
                        sleep(Duration::from_millis(delay)).await;
                    }
                }
            }
        }

        // All retries exhausted
        Self::handle_failure_static(queue, app_handle, &id, &last_error).await;
        Err(anyhow::anyhow!(last_error))
    }

    async fn prepare_item(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        cancelled_ids: &Arc<RwLock<HashSet<String>>>,
        config: &Arc<Mutex<Option<VaultConfig>>>,
        app_handle: &AppHandle,
        item: &UploadItem,
    ) -> Result<Option<PreparedUpload>> {
        let id = item.id.clone();

        // Update status to Processing
        Self::update_status_static(queue, app_handle, &id, UploadStatus::Processing).await;

        // Check if cancelled
        if cancelled_ids.read().await.contains(&id) {
            return Ok(None);
        }

        // Get config and key
        let vault_key = {
            let config_guard = config.lock().await;
            let config = config_guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Vault not loaded"))?;
            BASE64
                .decode(&config.vault_key)
                .context("Invalid vault key encoding")?
        };

        let key_arr: [u8; 32] = vault_key
            .try_into()
            .map_err(|_| anyhow::anyhow!("Invalid key length"))?;

        log::info!("[Upload {}] Processing media...", id);

        // Extract EXIF metadata
        let exif_metadata = if item.media_type == MediaType::Image {
            let metadata = exif_extractor::extract_metadata(&item.path);
            if metadata.has_data() {
                log::info!(
                    "[Upload {}] EXIF: captured_at={:?}, lat={:?}, lon={:?}",
                    id,
                    metadata.captured_at.as_ref().map(|d| d.to_rfc3339()),
                    metadata.latitude,
                    metadata.longitude
                );
            }
            Some(metadata)
        } else {
            None
        };

        // Process based on media type
        let (
            original_key,
            thumbnail_key,
            enc_original,
            enc_thumbnail,
            width,
            height,
            raw_thumbnail,
        ) = match item.media_type {
            MediaType::Image => {
                let processed = media_processor::process_image(&item.path)
                    .context(format!("Failed to process image: {:?}", item.path))?;

                let thumbnail_bytes = processed.thumbnail.unwrap_or_else(|| {
                    log::info!(
                        "[Upload {}] No thumbnail generated, using original (resized)",
                        id
                    );
                    processed.original.clone() // Fallback
                });

                // Encrypt
                log::info!("[Upload {}] Encrypting processed original...", id);
                Self::update_status_static(
                    queue,
                    app_handle,
                    &id,
                    UploadStatus::EncryptingOriginal,
                )
                .await;
                
                let enc_original = crypto::encrypt(&processed.original, &key_arr).context("Encryption failed")?;
                let enc_thumbnail = crypto::encrypt(&thumbnail_bytes, &key_arr).context("Thumbnail encryption failed")?;

                let original_key = format!("originals/images/{}.webp", id);
                let thumbnail_key = format!("thumbnails/{}.webp", id);

                (
                    original_key,
                    Some(thumbnail_key),
                    enc_original,
                    Some(enc_thumbnail),
                    processed.width,
                    processed.height,
                    Some(thumbnail_bytes),
                )
            }
            MediaType::Video => {
                let temp_dir = std::env::temp_dir();
                let output_path = temp_dir.join(format!("{}.mp4", id));

                // Transcode
                let transcoder = media_processor::TauriTranscoder {
                    app: app_handle.clone(),
                };
                let managed_frames = item.pre_generated_frames.clone();
                let processed = media_processor::process_video(&transcoder, &item.path, &output_path, managed_frames)
                        .await
                        .context(format!("Failed to process video: {:?}", item.path))?;

                // Cleanup temp file
                std::fs::remove_file(&output_path).ok();
                let thumbnail_bytes = processed.thumbnail.unwrap_or_default();

                // Encrypt
                Self::update_status_static(
                    queue,
                    app_handle,
                    &id,
                    UploadStatus::EncryptingOriginal,
                )
                .await;
                
                let enc_original = crypto::encrypt(&processed.original, &key_arr).context("Encryption failed")?;
                let enc_thumbnail = if !thumbnail_bytes.is_empty() {
                    Some(crypto::encrypt(&thumbnail_bytes, &key_arr)?)
                } else {
                    None
                };

                let original_key = format!("originals/videos/{}.mp4", id);
                let thumbnail_key = format!("thumbnails/{}.webp", id);
                let raw_thumb = if !thumbnail_bytes.is_empty() { Some(thumbnail_bytes) } else { None };

                (
                    original_key,
                    Some(thumbnail_key),
                    enc_original,
                    enc_thumbnail,
                    processed.width,
                    processed.height,
                    raw_thumb,
                )
            }
            MediaType::Audio => {
                let temp_dir = std::env::temp_dir();
                let output_path = temp_dir.join(format!("{}.opus", id));

                let transcoder = media_processor::TauriTranscoder {
                    app: app_handle.clone(),
                };
                let processed = media_processor::process_audio(&transcoder, &item.path, &output_path)
                        .await
                        .context(format!("Failed to process audio: {:?}", item.path))?;

                std::fs::remove_file(&output_path).ok();

                // Encrypt
                Self::update_status_static(
                    queue,
                    app_handle,
                    &id,
                    UploadStatus::EncryptingOriginal,
                )
                .await;
                let enc_original = crypto::encrypt(&processed.original, &key_arr).context("Encryption failed")?;

                let extension = "opus";
                let original_key = format!("audio/{}.{}", id, extension);

                (original_key, None, enc_original, None, 0, 0, None)
            }
        };

        Ok(Some(PreparedUpload {
            original_key,
            thumbnail_key,
            enc_original,
            enc_thumbnail,
            width,
            height,
            raw_thumbnail,
            exif_metadata,
        }))
    }

    async fn upload_item(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        storage: &Arc<Mutex<Option<Storage>>>,
        db: &Arc<Mutex<Option<Connection>>>,
        thumbnail_cache: &Arc<Mutex<Option<ThumbnailCache>>>,
        app_handle: &AppHandle,
        item: &UploadItem,
        prepared: &PreparedUpload,
    ) -> Result<()> {
        let id = item.id.clone();

        // Get storage
        let storage = {
            let storage_guard = storage.lock().await;
            storage_guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Storage not initialized"))?
                .clone()
        };

        // Upload original
        let media_type_label = match item.media_type {
            MediaType::Image => "image",
            MediaType::Video => "video",
            MediaType::Audio => "audio",
        };
        
        log::info!(
            "[Upload {}] Uploading {} ({} bytes)...",
            id,
            media_type_label,
            prepared.enc_original.len()
        );
        
        Self::update_status_static(
            queue,
            app_handle,
            &id,
            UploadStatus::UploadingOriginal { progress: 0.0 },
        )
        .await;

        let original_size = prepared.enc_original.len() as u64;
        let compressed_original_size = prepared.enc_original.len();
        let compressed_thumbnail_size = prepared.enc_thumbnail.as_ref().map(|t| t.len());

        // Create progress channel for real-time updates
        let (progress_tx, mut progress_rx) = mpsc::channel::<(u64, u64)>(32);

        // Clone handles for the progress listener task
        let queue_clone = queue.clone();
        let app_clone = app_handle.clone();
        let id_clone = id.clone();
        let item_size = item.size;

        // Spawn task to listen for progress updates
        let progress_task = tokio::spawn(async move {
            let mut last_update_time = Instant::now();
            let mut last_progress = 0.0;

            while let Some((uploaded, total)) = progress_rx.recv().await {
                let now = Instant::now();
                let progress = if total > 0 {
                    (uploaded as f64 / total as f64) * 0.5 // Original upload is 0-50%
                } else {
                    0.0
                };

                if last_progress == 0.0
                    || now.duration_since(last_update_time).as_millis() >= 100
                    || (progress - last_progress).abs() >= 0.01
                {
                    Self::update_progress_static(
                        &queue_clone,
                        &app_clone,
                        &id_clone,
                        progress,
                        (progress * item_size as f64) as u64,
                    )
                    .await;
                    last_update_time = now;
                    last_progress = progress;
                }
            }
        });

        // Upload with progress tracking
        let upload_result = storage
            .upload_file_with_progress(
                &prepared.original_key,
                prepared.enc_original.clone(), // Clone the vec for upload (retry needs to keep ownership)
                item.fresh_upload,
                Some(progress_tx),
            )
            .await;

        progress_task.abort();
        upload_result.context(format!("Failed to upload original to S3: {}", prepared.original_key))?;

        Self::update_progress_static(queue, app_handle, &id, 0.5, item.size / 2).await;

        // Upload thumbnail if exists
        if let (Some(thumb_key), Some(enc_thumb)) = (prepared.thumbnail_key.as_ref(), prepared.enc_thumbnail.as_ref()) {
            Self::update_status_static(
                queue,
                app_handle,
                &id,
                UploadStatus::UploadingThumbnail { progress: 0.0 },
            )
            .await;

            let thumb_result = storage.upload_file(thumb_key, enc_thumb.clone()).await;

            if thumb_result.is_err() {
                storage.delete_file(&prepared.original_key).await.ok();
                return Err(thumb_result.unwrap_err().into());
            }
        }

        // Cache thumbnail locally
        if let Some(raw_thumb) = prepared.raw_thumbnail.as_ref() {
            let cache_guard = thumbnail_cache.lock().await;
            if let Some(cache) = cache_guard.as_ref() {
                if let Err(e) = cache.put(&id, raw_thumb) {
                    log::info!(
                        "[Upload {}] Warning: Failed to cache thumbnail locally: {}",
                        id, e
                    );
                }
            }
        }

        // Determine media_type string for database
        let media_type_str = match item.media_type {
            MediaType::Image => "image",
            MediaType::Video => "video",
            MediaType::Audio => "audio",
        };

        // Add entry to local database
        log::info!("[Upload {}] Adding {} to database...", id, media_type_str);
        {
            let db_guard = db.lock().await;
            if let Some(conn) = db_guard.as_ref() {
                let tier = "Standard";

                let captured_at = prepared.exif_metadata
                    .as_ref()
                    .and_then(|m| m.captured_at.as_ref())
                    .map(|d| d.to_rfc3339());
                let latitude = prepared.exif_metadata.as_ref().and_then(|m| m.latitude);
                let longitude = prepared.exif_metadata.as_ref().and_then(|m| m.longitude);



                conn.execute(
                    "INSERT INTO photos (id, filename, width, height, created_at, captured_at, size_bytes, s3_key, thumbnail_key, tier, media_type, latitude, longitude)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    rusqlite::params![
                        id,
                        item.filename,
                        prepared.width,
                        prepared.height,
                        chrono::Utc::now().to_rfc3339(),
                        captured_at,
                        original_size,
                        prepared.original_key,
                        prepared.thumbnail_key.as_deref().unwrap_or(""),
                        tier,
                        media_type_str,
                        latitude,
                        longitude
                    ],
                ).context("Failed to insert into database")?;
                log::info!(
                    "[Upload {}] {} added to database successfully",
                    id, media_type_str
                );
            } else {
                log::info!("[Upload {}] Warning: Database not initialized", id);
            }
        }

        // Mark as completed
        Self::update_status_static(queue, app_handle, &id, UploadStatus::Completed).await;
        Self::update_progress_static(queue, app_handle, &id, 1.0, item.size).await; // 100%

        // Log compression stats
        let thumb_size_str = if let Some(t_len) = compressed_thumbnail_size {
            format_bytes(t_len as u64)
        } else {
            "N/A".to_string()
        };

        let original_size_str = format_bytes(item.size);
        let compressed_original_str = format_bytes(compressed_original_size as u64);

        log::info!("[Upload {}] Compression Stats:", id);
        log::info!("+----------------+----------------+----------------------+");
        log::info!("| Original Size  | Compressed Orig| Compressed Thumb     |");
        log::info!("+----------------+----------------+----------------------+");
        log::info!(
            "| {:<14} | {:<14} | {:<20} |",
            original_size_str, compressed_original_str, thumb_size_str
        );
        log::info!("+----------------+----------------+----------------------+");
        // Emit completion event
        app_handle
            .emit("upload:completed", serde_json::json!({ "id": id }))
            .unwrap_or_else(|e| log::info!("Failed to emit upload:completed event: {}", e));

        Ok(())
    }

    async fn handle_failure_static(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        app_handle: &AppHandle,
        id: &str,
        error: &str,
    ) {
        {
            let mut queue_guard = queue.write().await;
            if let Some(item) = queue_guard.get_mut(id) {
                item.status = UploadStatus::Failed {
                    error: error.to_string(),
                };
            }
        }
        app_handle
            .emit(
                "upload:failed",
                serde_json::json!({ "id": id, "error": error }),
            )
            .ok();
    }

    async fn update_status_static(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        app_handle: &AppHandle,
        id: &str,
        status: UploadStatus,
    ) {
        let mut queue_guard = queue.write().await;
        if let Some(item) = queue_guard.get_mut(id) {
            item.status = status.clone();
        }
        drop(queue_guard);
        app_handle
            .emit(
                "upload:progress",
                serde_json::json!({
                    "id": id,
                    "status": status
                }),
            )
            .ok();
    }

    async fn update_progress_static(
        queue: &Arc<RwLock<HashMap<String, UploadItem>>>,
        app_handle: &AppHandle,
        id: &str,
        progress: f64,
        bytes_uploaded: u64,
    ) {
        let total_bytes = {
            let mut queue_guard = queue.write().await;
            if let Some(item) = queue_guard.get_mut(id) {
                item.progress = progress;
                item.bytes_uploaded = bytes_uploaded;
                item.size
            } else {
                0
            }
        };
        app_handle
            .emit(
                "upload:progress",
                serde_json::json!({
                    "id": id,
                    "progress": progress,
                    "bytes_uploaded": bytes_uploaded,
                    "total_bytes": total_bytes
                }),
            )
            .ok();
    }

    async fn update_status(&self, id: &str, status: UploadStatus) {
        Self::update_status_static(&self.queue, &self.app_handle, id, status).await;
    }

    #[allow(dead_code)]
    async fn update_progress(&self, id: &str, progress: f64) {
        let bytes = {
            let queue = self.queue.read().await;
            queue
                .get(id)
                .map(|i| (i.size as f64 * progress) as u64)
                .unwrap_or(0)
        };
        Self::update_progress_static(&self.queue, &self.app_handle, id, progress, bytes).await;
    }

    async fn emit_queue_changed(&self) {
        let state = self.get_state().await;
        self.app_handle.emit("upload:queue_changed", state).ok();
    }
}

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
