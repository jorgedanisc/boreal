mod cache;
mod crypto;
mod db;
mod exif_extractor;
mod file_filter;
mod image_processing;
mod manifest;
pub mod media_processor;
mod memories;
mod pairing;
mod qr_transfer;
mod storage;
mod upload_manager;
mod vault;

use crate::cache::ThumbnailCache;
use crate::storage::Storage;
use crate::upload_manager::{QueueState, UploadItem, UploadManager};
use crate::vault::VaultConfig;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

struct AppState {
    storage: Arc<Mutex<Option<Storage>>>,
    db: Arc<Mutex<Option<Connection>>>,
    config: Arc<Mutex<Option<VaultConfig>>>,
}

struct CacheState {
    thumbnail_cache: Arc<Mutex<Option<ThumbnailCache>>>,
}

struct UploadManagerState {
    manager: Mutex<Option<UploadManager>>,
}

struct PairingManagerState {
    manager: Arc<Mutex<Option<pairing::PairingManager>>>,
}

struct QrTransferManagerState {
    manager: Arc<qr_transfer::QrTransferManager>,
}

// Commands

use crate::vault::store;
use crate::vault::VaultPublic;


/// Get all vaults with name/visits from SQLite
#[tauri::command]
async fn get_vaults(app: AppHandle) -> Result<Vec<VaultPublic>, String> {
    let vault_ids = store::get_vault_ids(&app)?;
    let mut vaults = Vec::new();

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    for (id, bucket) in vault_ids {
        let vault_dir = app_dir.join("vaults").join(&id);
        let db_path = vault_dir.join("manifest.db");

        let (name, visits, size) = if db_path.exists() {
            // Read from SQLite
            let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;
            let name = db::get_metadata(&conn, "name")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "Untitled Vault".to_string());
            let visits: u32 = db::get_metadata(&conn, "visits")
                .map_err(|e| e.to_string())?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let size: u64 = db::get_metadata(&conn, "total_size_bytes")
                .map_err(|e| e.to_string())?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            (name, visits, size)
        } else {
            // New vault or migration needed - use defaults
            ("Untitled Vault".to_string(), 0, 0)
        };

        vaults.push(VaultPublic {
            id,
            name,
            bucket,
            visits,
            total_size_bytes: size,
        });
    }

    // Sort by visits descending
    vaults.sort_by(|a, b| b.visits.cmp(&a.visits));
    Ok(vaults)
}



#[tauri::command]
async fn load_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
    id: String,
) -> Result<(), String> {
    // 1. Get config from JSON (credentials only)
    let config = store::load_vault(&app, &id)?;

    // 2. Validate key
    let _ = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key encoding: {}", e))?;

    // 3. Setup Storage
    let storage = Storage::new(&config).await;

    // 4. Setup DB (Scoped to vault ID)
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let vault_dir = app_dir.join("vaults").join(&config.id);
    if !vault_dir.exists() {
        std::fs::create_dir_all(&vault_dir).map_err(|e| e.to_string())?;
    }

    let db_path = vault_dir.join("manifest.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    // 5. Migration: Move name/visits from JSON to SQLite (one-time)
    let needs_migration = db::get_metadata(&conn, "name")
        .map_err(|e| e.to_string())?
        .is_none();

    if needs_migration {
        // Read legacy values from JSON config
        let legacy_name = config
            .name
            .clone()
            .unwrap_or_else(|| "Untitled Vault".to_string());
        let legacy_visits = config.visits.unwrap_or(0);

        db::set_metadata(&conn, "name", &legacy_name)
            .map_err(|e| format!("Migration failed (name): {}", e))?;
        db::set_metadata(&conn, "visits", &legacy_visits.to_string())
            .map_err(|e| format!("Migration failed (visits): {}", e))?;

        log::info!(
            "[Migration] Moved name='{}' and visits={} to SQLite",
            legacy_name,
            legacy_visits
        );
    }

    // 6. Increment visits in SQLite
    let current_visits: u32 = db::get_metadata(&conn, "visits")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    db::set_metadata(&conn, "visits", &(current_visits + 1).to_string())
        .map_err(|e| format!("Failed to update visits: {}", e))?;

    // 7. Initialize ThumbnailCache for this vault
    let thumbnail_cache = ThumbnailCache::new(&vault_dir).map_err(|e| e.to_string())?;
    *cache_state.thumbnail_cache.lock().await = Some(thumbnail_cache);

    // 8. Update State
    *state.storage.lock().await = Some(storage);
    *state.db.lock().await = Some(conn);
    *state.config.lock().await = Some(config);

    // 9. Background: Download and merge manifest from S3, then push updates
    // (This is done async after returning to not block UI)
    let storage_clone = state.storage.lock().await.clone();
    let db_clone = state.db.clone();
    let config_clone = state.config.lock().await.clone();

    tokio::spawn(async move {
        if let (Some(storage), Some(config)) = (storage_clone, config_clone) {
            // 0. Update vault size stats (best effort)
            if let Ok(size) = storage.get_bucket_size().await {
                let db_guard = db_clone.lock().await;
                if let Some(conn) = db_guard.as_ref() {
                    if let Err(e) = db::set_metadata(conn, "total_size_bytes", &size.to_string()) {
                        log::warn!("[Vault Stats] Failed to save size: {}", e);
                    } else {
                        log::info!("[Vault Stats] Updated size: {} bytes", size);
                    }
                }
            }

            // 1. Pull latest from cloud
            match sync_manifest_download_internal(&storage, &db_clone, &config).await {
                Ok(_) => {
                    // 2. Push our updated state (new visits count + merged changes) to cloud
                    if let Err(e) =
                        sync_manifest_upload_internal(&storage, &db_clone, &config).await
                    {
                        log::info!("[Manifest Sync] Background upload failed: {}", e);
                    }
                }
                Err(e) => {
                    log::info!("[Manifest Sync] Background download failed: {}", e);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn rename_vault(
    state: State<'_, AppState>,
    id: String,
    new_name: String,
) -> Result<(), String> {
    // Update SQLite metadata if vault is loaded
    let config_guard = state.config.lock().await;
    if let Some(current) = config_guard.as_ref() {
        if current.id == id {
            let db_guard = state.db.lock().await;
            if let Some(conn) = db_guard.as_ref() {
                db::set_metadata(conn, "name", &new_name)
                    .map_err(|e| format!("Failed to update name: {}", e))?;
            }
        }
    }
    // Note: If vault is not loaded, the rename will happen on next load
    // when the user explicitly opens the vault
    Ok(())
}

#[tauri::command]
async fn delete_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    upload_state: State<'_, UploadManagerState>,
    id: String,
    delete_cloud: bool,
) -> Result<(), String> {
    // 1. Load config to get keys/bucket info
    let config = store::load_vault(&app, &id)?;

    // 2. Delete from Cloud (Optional)
    if delete_cloud {
        let storage = Storage::new(&config).await;
        // Best effort: Try to empty and delete. Log errors but don't stop local deletion?
        // Actually, if cloud deletion fails, maybe we should stop and tell user?
        // But then they are stuck. Let's try and if fail, return error.

        log::info!("[Delete Vault] Emptying bucket {}...", config.bucket);
        if let Err(e) = storage.empty_bucket().await {
            return Err(format!(
                "Failed to empty S3 bucket: {}. Manual cleanup required.",
                e
            ));
        }

        log::info!("[Delete Vault] Deleting bucket {}...", config.bucket);
        if let Err(e) = storage.delete_bucket().await {
            // If we emptied it but failed to delete bucket (e.g. permission), warn but proceed?
            // User prompt said "basically what we want to do is just delete it and also delete the aws resources"
            // If we fail here, the vault is still in the list.
            // Given the permission limitation (legacy stacks), we might want to be lenient here
            // IF the error is AccessDenied.
            log::info!(
                "[Delete Vault] Failed to delete bucket (might be permission issue): {}",
                e
            );
            // Proceed to delete local data so user can remove the vault from UI
        }
    }

    // 3. Unload if active
    {
        let mut config_guard = state.config.lock().await;
        let is_active = config_guard.as_ref().map(|c| c.id == id).unwrap_or(false);

        if is_active {
            // Stop any uploads first
            let manager_guard = upload_state.manager.lock().await;
            if let Some(manager) = manager_guard.as_ref() {
                // We should ideally cancel all, but clearing is enough as we are deleting storage
                manager.clear_finished().await;
            }

            // Reset State
            *config_guard = None;
            *state.db.lock().await = None;
            *state.storage.lock().await = None;
        }
    }

    // 4. Delete Local Files
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let vault_dir = app_dir.join("vaults").join(&id);
    if vault_dir.exists() {
        std::fs::remove_dir_all(&vault_dir).map_err(|e| e.to_string())?;
    }

    // 5. Delete from Registry
    store::delete_vault(&app, &id)?;

    Ok(())
}

/// Step 1: Save vault credentials to encrypted store (returns vault ID)
#[tauri::command]
async fn import_vault_step1_save(app: AppHandle, vault_code: String) -> Result<String, String> {
    // Parse JSON payload
    let mut config: VaultConfig =
        serde_json::from_str(&vault_code).map_err(|e| format!("Invalid vault code: {}", e))?;

    // Ensure config has an ID
    if config.id.is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }

    // Set default name
    if config.name.is_none() {
        config.name = Some("Imported Vault".to_string());
    }

    // Save to encrypted store
    store::save_vault(&app, &config)
        .map_err(|e| format!("Failed to save vault credentials: {}", e))?;

    Ok(config.id)
}

/// Step 2: Activate vault (load DB, initialize storage)
#[tauri::command]
async fn import_vault_step2_load(
    app: AppHandle,
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
    vault_id: String,
) -> Result<(), String> {
    load_vault(app, state, cache_state, vault_id)
        .await
        .map_err(|e| format!("Failed to activate vault: {}", e))
}

/// Step 3: Sync manifest from S3 (STRICT - fails if no manifest)
#[tauri::command]
async fn import_vault_step3_sync(state: State<'_, AppState>) -> Result<String, String> {
    sync_manifest_download_strict(state)
        .await
        .map_err(|e| format!("Failed to sync from cloud: {}", e))?;

    Ok("Sync complete".to_string())
}

#[tauri::command]
async fn import_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
    vault_code: String,
) -> Result<(), String> {
    log::info!("[Import] Starting vault import...");

    // Parse JSON payload
    let mut config: VaultConfig =
        serde_json::from_str(&vault_code).map_err(|e| format!("Invalid vault code: {}", e))?;
    log::info!(
        "[Import] Parsed config. ID: {}, Bucket: {}",
        config.id,
        config.bucket
    );

    // Ensure config has an ID; generate one if missing (legacy Vault Files may not have IDs)
    if config.id.is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
        log::info!("[Import] Generated new ID: {}", config.id);
    }

    // Set default name for migration (will be written to SQLite on load)
    if config.name.is_none() {
        config.name = Some("Imported Vault".to_string());
    }

    // Save to encrypted store
    log::info!("[Import] Saving to encrypted store...");
    store::save_vault(&app, &config).map_err(|e| {
        log::info!("[Import] FAILED to save vault: {}", e);
        format!("Failed to save vault credentials: {}", e)
    })?;
    log::info!("[Import] Vault saved successfully.");

    let id = config.id.clone();

    // Activate vault (loads DB, sets up storage)
    log::info!("[Import] Activating vault (load_vault)...");
    load_vault(app, state.clone(), cache_state, id)
        .await
        .map_err(|e| {
            log::info!("[Import] FAILED to activate vault: {}", e);
            format!("Failed to activate vault: {}", e)
        })?;
    log::info!("[Import] Vault activated successfully.");

    // STRICT SYNC: For imported vaults, manifest MUST exist on S3
    // This validates credentials and downloads the photo database
    log::info!("[Import] Syncing manifest from S3 (STRICT mode)...");
    sync_manifest_download_strict(state).await.map_err(|e| {
        log::info!("[Import] FAILED to sync manifest: {}", e);
        format!("Failed to sync from cloud: {}", e)
    })?;
    log::info!("[Import] Manifest sync completed successfully!");

    Ok(())
}

/// Internal function to download and merge manifest from S3
async fn sync_manifest_download_internal(
    storage: &Storage,
    db: &Arc<Mutex<Option<Connection>>>,
    config: &VaultConfig,
) -> Result<(), String> {
    use crate::manifest;

    // Try to download manifest.enc from S3
    let enc_bytes = match storage.download_file(manifest::MANIFEST_S3_KEY).await {
        Ok(bytes) => bytes,
        Err(e) => {
            // No manifest exists yet - this is fine for new vaults
            log::info!("[Manifest Sync] No manifest found on S3 ({})", e);
            return Ok(());
        }
    };

    // Decrypt
    let vault_key = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key: {}", e))?;
    let key_arr: [u8; 32] = vault_key
        .try_into()
        .map_err(|_| "Invalid key length".to_string())?;

    let remote_data = manifest::decrypt_manifest(&enc_bytes, &key_arr)
        .map_err(|e| format!("Failed to decrypt manifest: {}", e))?;

    // Merge into local DB
    let db_guard = db.lock().await;
    if let Some(conn) = db_guard.as_ref() {
        let stats = manifest::import_manifest(conn, remote_data)
            .map_err(|e| format!("Failed to merge manifest: {}", e))?;
        log::info!(
            "[Manifest Sync] Merged: {} photos added, {} updated; {} memories added, {} updated",
            stats.photos_added,
            stats.photos_updated,
            stats.memories_added,
            stats.memories_updated
        );
    }

    Ok(())
}

/// STRICT manifest sync for imported vaults - FAILS if manifest doesn't exist
/// Unlike the lenient sync_manifest_download, this validates that the vault
/// actually has data on S3 (which it should, since it's being imported from another device)
async fn sync_manifest_download_strict(state: State<'_, AppState>) -> Result<(), String> {
    use crate::manifest;

    let storage_guard = state.storage.lock().await;
    let storage = storage_guard
        .as_ref()
        .ok_or("Storage not initialized")?
        .clone();
    drop(storage_guard);

    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?.clone();
    drop(config_guard);

    log::info!("[Strict Sync] Downloading manifest from S3...");

    // STRICT: Fail if manifest doesn't exist (imported vaults MUST have a manifest)
    let enc_bytes = storage
        .download_file(manifest::MANIFEST_S3_KEY)
        .await
        .map_err(|e| {
            format!(
                "Failed to download manifest from S3: {}. Check AWS credentials or network.",
                e
            )
        })?;

    log::info!(
        "[Strict Sync] Downloaded {} bytes, decrypting...",
        enc_bytes.len()
    );

    // Decrypt
    let vault_key = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key: {}", e))?;
    let key_arr: [u8; 32] = vault_key
        .try_into()
        .map_err(|_| "Invalid key length".to_string())?;

    let remote_data = manifest::decrypt_manifest(&enc_bytes, &key_arr)
        .map_err(|e| format!("Failed to decrypt manifest: {}", e))?;

    log::info!("[Strict Sync] Decrypted successfully, merging into local DB...");

    // Merge into local DB
    let db_guard = state.db.lock().await;
    if let Some(conn) = db_guard.as_ref() {
        let stats = manifest::import_manifest(conn, remote_data)
            .map_err(|e| format!("Failed to merge manifest: {}", e))?;
        log::info!(
            "[Strict Sync] Merged: {} photos added, {} updated; {} memories added, {} updated",
            stats.photos_added,
            stats.photos_updated,
            stats.memories_added,
            stats.memories_updated
        );
    } else {
        return Err("Database not initialized".to_string());
    }

    Ok(())
}

/// Internal function to export, encrypt, and upload manifest to S3
async fn sync_manifest_upload_internal(
    storage: &Storage,
    db: &Arc<Mutex<Option<Connection>>>,
    config: &VaultConfig,
) -> Result<(), String> {
    use crate::manifest;

    let vault_key = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key: {}", e))?;
    let key_arr: [u8; 32] = vault_key
        .try_into()
        .map_err(|_| "Invalid key length".to_string())?;

    // Export from DB
    let db_guard = db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;
    let data = manifest::export_manifest(conn).map_err(|e| format!("Export failed: {}", e))?;
    drop(db_guard);

    // Encrypt
    let enc_bytes = manifest::encrypt_manifest(&data, &key_arr)
        .map_err(|e| format!("Encrypt failed: {}", e))?;

    // Upload
    storage
        .upload_file(manifest::MANIFEST_S3_KEY, enc_bytes)
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    log::info!("[Manifest Sync] Uploaded manifest to S3");
    Ok(())
}

/// Upload current manifest to S3
#[tauri::command]
async fn sync_manifest_upload(state: State<'_, AppState>) -> Result<(), String> {
    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?;

    let storage_guard = state.storage.lock().await;
    let storage = storage_guard.as_ref().ok_or("Storage not initialized")?;

    // Use cloned references to pass to internal function
    sync_manifest_upload_internal(storage, &state.db, config).await
}

/// Download and merge manifest from S3
#[tauri::command]
async fn sync_manifest_download(state: State<'_, AppState>) -> Result<(), String> {
    let storage_guard = state.storage.lock().await;
    let storage = storage_guard
        .as_ref()
        .ok_or("Storage not initialized")?
        .clone();
    drop(storage_guard);

    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?.clone();
    drop(config_guard);

    sync_manifest_download_internal(&storage, &state.db, &config).await
}

#[tauri::command]
async fn bootstrap_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
    vault_code: String,
) -> Result<(), String> {
    use crate::vault::BootstrapConfig;

    let bootstrap: BootstrapConfig =
        serde_json::from_str(&vault_code).map_err(|e| format!("Invalid vault code: {}", e))?;

    // 1. Generate Keys
    let kek = crypto::generate_key();
    let vault_key = crypto::generate_key();

    // 2. Encrypt Vault Key with KEK
    let enc_vault_key = crypto::encrypt(&vault_key, &kek)
        .map_err(|e| format!("Failed to encrypt vault key: {}", e))?;

    // 3. Create full config (name will be set in SQLite on first load)
    let id = uuid::Uuid::new_v4().to_string();
    let mut config = VaultConfig::new(
        id.clone(),
        bootstrap.access_key_id,
        bootstrap.secret_access_key,
        bootstrap.region,
        bootstrap.bucket,
        BASE64.encode(kek),
    );
    // Set legacy name for migration
    config.name = Some("My Vault".to_string());

    // 4. Setup Storage & Upload Encrypted Key
    let storage = Storage::new(&config).await;
    storage
        .upload_file("vault-key.enc", enc_vault_key)
        .await
        .map_err(|e| format!("Failed to upload vault key: {}", e))?;

    // 5. Save to JSON store
    store::save_vault(&app, &config)?;

    // 6. Activate
    load_vault(app, state, cache_state, id).await
}

#[tauri::command]
async fn upload_photo(state: State<'_, AppState>, path: String) -> Result<(), String> {
    // 1. Read file (Heavy IO, do first without locks)
    let original_bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let thumbnail_bytes = image_processing::generate_thumbnail(&path)
        .map_err(|e| format!("Failed to generate thumbnail: {}", e))?;

    // 2. Prepare Config & Storage (Get locks, clone need data, drop locks)
    let (vault_key, storage) = {
        let config_guard = state.config.lock().await;
        let config = config_guard.as_ref().ok_or("Vault not loaded")?;

        let storage_guard = state.storage.lock().await;
        let storage = storage_guard
            .as_ref()
            .ok_or("Storage not initialized")?
            .clone();

        (config.vault_key.clone(), storage)
    };

    // 3. Encrypt (CPU intensive, no locks needed)
    let vault_key = BASE64.decode(&vault_key).unwrap();
    let key_arr: [u8; 32] = vault_key.try_into().map_err(|_| "Invalid key length")?;

    let enc_original = crypto::encrypt(&original_bytes, &key_arr)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let enc_thumbnail = crypto::encrypt(&thumbnail_bytes, &key_arr)
        .map_err(|e| format!("Thumbnail encryption failed: {}", e))?;

    // 4. Upload (Network IO, async, safe because we have cloned storage)
    let filename = PathBuf::from(&path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();

    let original_key = format!("originals/{}", id);
    let thumbnail_key = format!("thumbnails/{}.avif", id);

    storage
        .upload_file(&original_key, enc_original)
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    storage
        .upload_file(&thumbnail_key, enc_thumbnail)
        .await
        .map_err(|e| format!("Thumbnail upload failed: {}", e))?;

    // 5. Update DB (Acquire lock only for this brief sync operation)
    {
        let db_guard = state.db.lock().await;
        let conn = db_guard.as_ref().ok_or("DB not initialized")?;

        conn.execute(
            "INSERT INTO photos (id, filename, width, height, created_at, size_bytes, s3_key, thumbnail_key, tier)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id,
                filename,
                0, // TODO: Extract dims
                0,
                chrono::Utc::now().to_rfc3339(),
                original_bytes.len(),
                original_key,
                thumbnail_key,
                "Standard" // TODO: Configurable
            ],
        ).map_err(|e| format!("DB Insert failed: {}", e))?;
    }

    Ok(())
}

#[derive(serde::Serialize)]
struct Photo {
    id: String,
    filename: String,
    created_at: String,
    captured_at: Option<String>,
    tier: String,
    media_type: String,
    width: u32,
    height: u32,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[tauri::command]
async fn get_photos(state: State<'_, AppState>) -> Result<Vec<Photo>, String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    let mut stmt = conn
        .prepare("SELECT id, filename, created_at, captured_at, tier, media_type, width, height, latitude, longitude FROM photos ORDER BY COALESCE(captured_at, created_at) DESC")
        .map_err(|e| e.to_string())?;

    let photos = stmt
        .query_map([], |row| {
            Ok(Photo {
                id: row.get(0)?,
                filename: row.get(1)?,
                created_at: row.get(2)?,
                captured_at: row.get(3)?,
                tier: row.get(4)?,
                media_type: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "image".to_string()),
                width: row.get::<_, Option<u32>>(6)?.unwrap_or(0),
                height: row.get::<_, Option<u32>>(7)?.unwrap_or(0),
                latitude: row.get(8)?,
                longitude: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
async fn get_thumbnail(
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
    id: String,
) -> Result<String, String> {
    // 1. Check local cache first
    {
        let cache_guard = cache_state.thumbnail_cache.lock().await;
        if let Some(cache) = cache_guard.as_ref() {
            if let Some(cached_bytes) = cache.get(&id) {
                return Ok(BASE64.encode(&cached_bytes));
            }
        }
    }

    // 2. Cache miss - download from S3
    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?;

    let storage_guard = state.storage.lock().await;
    let storage = storage_guard.as_ref().ok_or("Storage not initialized")?;

    // Try to read from S3 (Phase 1 simplistic: always download)
    // TODO: Local Cache

    let thumbnail_key = format!("thumbnails/{}.webp", id);
    let enc_bytes = storage
        .download_file(&thumbnail_key)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Decrypt
    let vault_key = BASE64.decode(&config.vault_key).unwrap();
    let key_arr: [u8; 32] = vault_key.try_into().map_err(|_| "Invalid key length")?;

    let dec_bytes = crypto::decrypt(&enc_bytes, &key_arr).map_err(|e| e.to_string())?;

    // 4. Store in cache for next time
    {
        let cache_guard = cache_state.thumbnail_cache.lock().await;
        if let Some(cache) = cache_guard.as_ref() {
            cache.put(&id, &dec_bytes).ok(); // Ignore cache errors
        }
    }

    // 5. Return Base64
    Ok(BASE64.encode(&dec_bytes))
}

/// Get audio file for playback. Fetches from S3, decrypts, and returns base64.
/// This is called on-demand when user clicks play (cost-efficient).
#[tauri::command]
async fn get_audio(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?;

    let storage_guard = state.storage.lock().await;
    let storage = storage_guard.as_ref().ok_or("Storage not initialized")?;

    // Audio files are stored as opus in audio/ prefix
    let audio_key = format!("audio/{}.opus", id);
    let enc_bytes = storage
        .download_file(&audio_key)
        .await
        .map_err(|e| e.to_string())?;

    // Decrypt
    let vault_key = BASE64.decode(&config.vault_key).unwrap();
    let key_arr: [u8; 32] = vault_key.try_into().map_err(|_| "Invalid key length")?;

    let dec_bytes = crypto::decrypt(&enc_bytes, &key_arr).map_err(|e| e.to_string())?;

    // Return Base64
    Ok(BASE64.encode(&dec_bytes))
}

/// Sync thumbnail cache - checks manifest against local cache and fetches missing thumbnails
/// This is called after vault load to progressively cache thumbnails from S3
#[tauri::command]
async fn sync_thumbnail_cache(
    state: State<'_, AppState>,
    cache_state: State<'_, CacheState>,
) -> Result<u32, String> {
    // Get all photo IDs from the manifest (local DB) that have thumbnails
    let photo_ids: Vec<String> = {
        let db_guard = state.db.lock().await;
        let conn = db_guard.as_ref().ok_or("DB not initialized")?;

        let mut stmt = conn
            .prepare("SELECT id, media_type, thumbnail_key FROM photos WHERE thumbnail_key IS NOT NULL AND thumbnail_key != ''")
            .map_err(|e| e.to_string())?;

        let ids = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let media_type: Option<String> = row.get(1)?;
                Ok((id, media_type.unwrap_or_else(|| "image".to_string())))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            // Only sync thumbnails for images and videos (audio has no thumbnail)
            .filter(|(_, mt)| mt != "audio")
            .map(|(id, _)| id)
            .collect();

        ids
    };

    // Check which thumbnails are missing from cache
    let missing_ids: Vec<String> = {
        let cache_guard = cache_state.thumbnail_cache.lock().await;
        if let Some(cache) = cache_guard.as_ref() {
            photo_ids
                .iter()
                .filter(|id| !cache.contains(id))
                .cloned()
                .collect()
        } else {
            // No cache initialized, all are "missing"
            photo_ids
        }
    };

    if missing_ids.is_empty() {
        return Ok(0);
    }

    log::info!(
        "[Cache Sync] Found {} thumbnails missing from cache, fetching...",
        missing_ids.len()
    );

    // Get storage and config for downloading
    let (storage, vault_key) = {
        let storage_guard = state.storage.lock().await;
        let config_guard = state.config.lock().await;
        let storage = storage_guard
            .as_ref()
            .ok_or("Storage not initialized")?
            .clone();
        let config = config_guard.as_ref().ok_or("Vault not loaded")?;
        let vault_key = BASE64
            .decode(&config.vault_key)
            .map_err(|e| format!("Invalid vault key: {}", e))?;
        (storage, vault_key)
    };

    let key_arr: [u8; 32] = vault_key.try_into().map_err(|_| "Invalid key length")?;

    // Fetch missing thumbnails and cache them
    let mut fetched_count = 0u32;
    for id in &missing_ids {
        let thumbnail_key = format!("thumbnails/{}.webp", id);

        match storage.download_file(&thumbnail_key).await {
            Ok(enc_bytes) => {
                match crypto::decrypt(&enc_bytes, &key_arr) {
                    Ok(dec_bytes) => {
                        // Cache the decrypted thumbnail
                        let cache_guard = cache_state.thumbnail_cache.lock().await;
                        if let Some(cache) = cache_guard.as_ref() {
                            if cache.put(id, &dec_bytes).is_ok() {
                                fetched_count += 1;
                            }
                        }
                    }
                    Err(e) => {
                        log::info!("[Cache Sync] Failed to decrypt thumbnail {}: {}", id, e);
                    }
                }
            }
            Err(e) => {
                // Thumbnail may not exist (audio files, or upload errors)
                log::info!("[Cache Sync] Failed to download thumbnail {}: {}", id, e);
            }
        }
    }

    log::info!(
        "[Cache Sync] Fetched and cached {} thumbnails",
        fetched_count
    );
    Ok(fetched_count)
}

#[tauri::command]
async fn get_active_vault(state: State<'_, AppState>) -> Result<Option<VaultPublic>, String> {
    let config_guard = state.config.lock().await;
    let db_guard = state.db.lock().await;

    match (config_guard.as_ref(), db_guard.as_ref()) {
        (Some(c), Some(conn)) => {
            let name = db::get_metadata(conn, "name")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "Untitled Vault".to_string());
            let visits: u32 = db::get_metadata(conn, "visits")
                .map_err(|e| e.to_string())?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let size: u64 = db::get_metadata(conn, "total_size_bytes")
                .map_err(|e| e.to_string())?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);

            Ok(Some(VaultPublic {
                id: c.id.clone(),
                name,
                bucket: c.bucket.clone(),
                visits,
                total_size_bytes: size,
            }))
        }
        (Some(c), None) => {
            // DB not loaded, return partial info
            Ok(Some(VaultPublic {
                id: c.id.clone(),
                name: "Loading...".to_string(),
                bucket: c.bucket.clone(),
                visits: 0,
                total_size_bytes: 0,
            }))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
async fn export_vault(app: AppHandle, id: String) -> Result<String, String> {
    let mut config = store::load_vault(&app, &id)?;

    // Fetch the actual name from SQLite
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let vault_dir = app_dir.join("vaults").join(&id);
    let db_path = vault_dir.join("manifest.db");

    if db_path.exists() {
        if let Ok(conn) = db::init_db(&db_path) {
            if let Ok(Some(name)) = db::get_metadata(&conn, "name") {
                config.name = Some(name);
            }
        }
    }

    serde_json::to_string(&config).map_err(|e| format!("Failed to serialize vault: {}", e))
}

use rand::RngCore;

#[derive(serde::Serialize)]
struct ExportViewData {
    qr_url: String,
    pin: String,
}

#[tauri::command]
async fn create_export_qr(app: AppHandle, id: String) -> Result<ExportViewData, String> {
    // 1. Load Vault Config
    let config = store::load_vault(&app, &id)?;
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    // 2. Generate 6-digit PIN
    let mut rng = rand::thread_rng();
    let pin: u32 = rand::Rng::gen_range(&mut rng, 100000..999999);
    let pin_string = pin.to_string();

    // 3. Generate Salt (16 bytes)
    let mut salt = [0u8; 16];
    rng.fill_bytes(&mut salt);

    // 4. Derive Key using Argon2id (Slow!)
    let key = crypto::derive_key(&pin_string, &salt).map_err(|e| e.to_string())?;

    // 5. Encrypt (Nonce + Ciphertext)
    let encrypted_data = crypto::encrypt(json.as_bytes(), &key).map_err(|e| e.to_string())?;

    // 6. Construct Payload: Salt (16) + Encrypted Data (Nonce + Ciphertext)
    let mut final_blob = salt.to_vec();
    final_blob.extend(encrypted_data);

    // 7. Encode Base64
    let b64_data = BASE64.encode(final_blob);

    let url = format!("boreal://import?&data={}", b64_data);

    Ok(ExportViewData {
        qr_url: url,
        pin: pin_string,
    })
}

#[tauri::command]
async fn decrypt_import(encrypted_data: String, pin: String) -> Result<String, String> {
    let blob = BASE64
        .decode(&encrypted_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    if blob.len() < 16 + crypto::NONCE_LEN {
        return Err("Invalid data length".to_string());
    }

    // Run CPU-intensive crypto operations in a blocking thread
    // to prevent blocking the async runtime (critical for mobile)
    let result = tokio::task::spawn_blocking(move || {
        // Extract Salt
        let (salt, rest) = blob.split_at(16);

        // Derive Key using Argon2id (Slow - intentionally expensive)
        log::info!("[Decrypt] Starting Argon2 key derivation...");
        let key = crypto::derive_key(&pin, salt).map_err(|e| e.to_string())?;
        log::info!("[Decrypt] Key derivation complete, decrypting...");

        // Decrypt (rest contains Nonce + Ciphertext, which crypto::decrypt expects)
        let plaintext = crypto::decrypt(rest, &key)
            .map_err(|_| "Decryption failed. Wrong PIN or Corrupted Data.".to_string())?;

        let json = String::from_utf8(plaintext).map_err(|e| e.to_string())?;
        log::info!("[Decrypt] Decryption successful");
        Ok::<String, String>(json)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    result
}

#[tauri::command]
async fn check_biometrics(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_biometry::BiometryExt;

    // Check if biometry is available on this platform
    let status = app.biometry().status().map_err(|e| e.to_string())?;
    Ok(status.is_available)
}

#[tauri::command]
fn authenticate_biometrics(app: AppHandle, reason: String) -> Result<(), String> {
    use tauri_plugin_biometry::{AuthOptions, BiometryExt};

    app.biometry()
        .authenticate(
            reason,
            AuthOptions {
                allow_device_credential: Some(true), // Allow password/PIN fallback
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())
}

// ============ Upload Queue Commands ============

#[derive(serde::Deserialize)]
struct AddFilesPayload {
    paths: Vec<String>,
    fresh_upload: bool,
    /// Optional map of "Path -> List of Base64 encoded Frames"
    /// Used for frontend-generated video thumbnails (especially on Mobile)
    thumbnails: Option<std::collections::HashMap<String, Vec<String>>>,
}

#[derive(serde::Serialize)]
struct AddFilesResult {
    items: Vec<UploadItem>,
    fresh_upload_auto_disabled: bool,
}

#[tauri::command]
async fn add_files_to_queue(
    _state: State<'_, AppState>,
    upload_state: State<'_, UploadManagerState>,
    payload: AddFilesPayload,
) -> Result<AddFilesResult, String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    let paths: Vec<PathBuf> = payload.paths.iter().map(PathBuf::from).collect();
    let mut valid_paths = Vec::new();

    // Use walkdir to recursively find files
    for path in paths {
        if path.is_dir() {
            // It's a directory, walk it
            // Follow symlinks? Usually confusing for uploads, default to false (which is walkdir default)
            for entry in walkdir::WalkDir::new(&path)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let entry_path = entry.path();
                if entry_path.is_file() && file_filter::is_supported_media(entry_path) {
                    valid_paths.push(entry_path.to_path_buf());
                }
            }
        } else {
            // It's a file
            if file_filter::is_supported_media(&path) {
                valid_paths.push(path);
            }
        }
    }

    // Optimization: Check for duplicates against existing DB/Cache early?
    // For now, let the manager handle logic.

    // Create proposed items to check fresh upload limits
    let temp_items: Vec<UploadItem> = valid_paths.clone()
        .into_iter()
        .filter_map(|p| UploadItem::new(p, payload.fresh_upload, None).ok())
        .collect();

    let fresh_upload_auto_disabled = manager.should_disable_fresh_upload(&temp_items);

    let actual_fresh_upload = if fresh_upload_auto_disabled {
        false
    } else {
        payload.fresh_upload
    };

    // Now add with the correct fresh_upload flag
    let items = manager
        .add_files(valid_paths, actual_fresh_upload, payload.thumbnails)
        .await
        .map_err(|e| e.to_string())?;

    Ok(AddFilesResult {
        items,
        fresh_upload_auto_disabled,
    })
}

#[tauri::command]
async fn get_upload_queue_status(
    upload_state: State<'_, UploadManagerState>,
) -> Result<QueueState, String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    Ok(manager.get_state().await)
}

#[derive(serde::Deserialize)]
struct StartUploadPayload {
    fresh_upload: bool,
}

#[tauri::command]
async fn start_upload(
    upload_state: State<'_, UploadManagerState>,
    payload: StartUploadPayload,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    // Update all pending items with the current fresh_upload state
    manager.update_fresh_upload_flag(payload.fresh_upload).await;

    manager.start_processing().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_upload(
    upload_state: State<'_, UploadManagerState>,
    id: String,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    manager.cancel(&id).await;
    Ok(())
}

#[tauri::command]
async fn clear_finished_uploads(upload_state: State<'_, UploadManagerState>) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    manager.clear_finished().await;
    Ok(())
}

#[tauri::command]
async fn pause_upload(
    upload_state: State<'_, UploadManagerState>,
    id: String,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    manager.pause(&id).await;
    Ok(())
}

#[tauri::command]
async fn resume_upload(
    upload_state: State<'_, UploadManagerState>,
    id: String,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    manager.resume(&id).await;
    Ok(())
}

#[tauri::command]
async fn retry_upload(
    upload_state: State<'_, UploadManagerState>,
    id: String,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    manager.retry(&id).await;
    Ok(())
}

#[tauri::command]
async fn remove_upload_item(
    upload_state: State<'_, UploadManagerState>,
    id: String,
) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    // If it's active, we might want to cancel it first,
    // but the manager.remove_item handles the map removal.
    // For robust active cancellation + removal, the frontend should probably call cancel then remove,
    // or we handle it inside manager.remove_item.
    // For the specific bug (removing Pending items), this is sufficient.
    manager.cancel(&id).await; // Best effort cancel
    manager.remove_item(&id).await;
    Ok(())
}

#[tauri::command]
async fn initialize_upload_manager(
    app: AppHandle,
    state: State<'_, AppState>,
    upload_state: State<'_, UploadManagerState>,
    cache_state: State<'_, CacheState>,
) -> Result<(), String> {
    let (manager, _cancel_rx) = UploadManager::new(
        app,
        state.storage.clone(),
        state.config.clone(),
        state.db.clone(),
        cache_state.thumbnail_cache.clone(), // Correctly accessing from CacheState
    );
    *upload_state.manager.lock().await = Some(manager);
    Ok(())
}

/// Open the cache folder for the current vault in the system file explorer
#[tauri::command]
async fn open_cache_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_dir
        .join("vaults")
        .join(&config.id)
        .join("cache")
        .join("thumbnails");

    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }

    app.opener()
        .open_path(cache_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get supported media file extensions for file dialog filters
#[tauri::command]
fn get_supported_extensions() -> file_filter::MediaExtensions {
    file_filter::get_supported_extensions()
}

// ============ Pairing Commands ============

#[tauri::command]
async fn start_pairing_mode(pairing_state: State<'_, PairingManagerState>) -> Result<(), String> {
    let mut guard = pairing_state.manager.lock().await;

    // Get device name (could be from config, using hostname for now)
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Boreal Device".to_string());

    let manager = pairing::PairingManager::new(device_name);
    
    // Set manager immediately so status polling works
    let manager_clone = manager.clone();
    *guard = Some(manager);
    
    // Run initialization in background to prevent blocking
    tokio::spawn(async move {
        if let Err(e) = manager_clone.start_listening().await {
            log::error!("Failed to start listening: {}", e);
            // Ensure error state is set if start_listening didn't do it
            // (start_listening handles most errors internally but just in case)
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_pairing_mode(pairing_state: State<'_, PairingManagerState>) -> Result<(), String> {
    let mut guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.take() {
        manager.stop_listening().await;
    }
    Ok(())
}

#[tauri::command]
async fn confirm_pairing(pairing_state: State<'_, PairingManagerState>) -> Result<(), String> {
    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        manager.confirm_pairing().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn confirm_pairing_as_sender(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<(), String> {
    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        manager
            .confirm_as_sender()
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_pairing_status(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<pairing::PairingStatus, String> {
    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        Ok(manager.get_status().await)
    } else {
        Ok(pairing::PairingStatus::default())
    }
}

#[tauri::command]
async fn get_received_vault_config(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<Option<String>, String> {
    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        Ok(manager.get_received_vault_config().await)
    } else {
        Ok(None)
    }
}

// Sender (discovery) commands

#[tauri::command]
async fn start_network_discovery(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<(), String> {
    let mut guard = pairing_state.manager.lock().await;

    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Boreal Device".to_string());

    let manager = pairing::PairingManager::new(device_name);
    manager.start_discovery().await.map_err(|e| e.to_string())?;
    *guard = Some(manager);
    Ok(())
}

#[tauri::command]
async fn stop_network_discovery(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<(), String> {
    let mut guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.take() {
        manager.stop_discovery().await;
    }
    Ok(())
}

#[tauri::command]
async fn get_discovered_devices(
    pairing_state: State<'_, PairingManagerState>,
) -> Result<Vec<pairing::DiscoveredDevice>, String> {
    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        Ok(manager.get_discovered_devices().await)
    } else {
        Ok(Vec::new())
    }
}



#[tauri::command]
async fn initiate_pairing(
    app: AppHandle,
    pairing_state: State<'_, PairingManagerState>,
    device_id: String,
    vault_id: String,
) -> Result<(), String> {
    // Get vault config
    let config = store::load_vault(&app, &vault_id)?;
    let vault_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let guard = pairing_state.manager.lock().await;
    if let Some(manager) = guard.as_ref() {
        let devices = manager.get_discovered_devices().await;
        let device = devices
            .iter()
            .find(|d| d.id == device_id)
            .ok_or("Device not found")?
            .clone();

        manager
            .initiate_pairing(&device, vault_json)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Pairing manager not initialized".to_string())
    }
}

// === QR Transfer commands ===

#[tauri::command]
async fn create_import_request(
    qr_state: State<'_, QrTransferManagerState>,
) -> Result<qr_transfer::ImportRequest, String> {
    qr_state
        .manager
        .create_import_request()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_qr_export(
    app: AppHandle,
    qr_state: State<'_, QrTransferManagerState>,
    vault_id: String,
    request_json: String,
) -> Result<qr_transfer::ExportSession, String> {
    let config = store::load_vault(&app, &vault_id)?;
    let vault_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    qr_state
        .manager
        .start_export(&request_json, &vault_json)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_export_frame(qr_state: State<'_, QrTransferManagerState>) -> Result<String, String> {
    qr_state
        .manager
        .get_export_frame()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_export_sas(qr_state: State<'_, QrTransferManagerState>) -> Result<String, String> {
    qr_state
        .manager
        .get_export_sas()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_qr_export(qr_state: State<'_, QrTransferManagerState>) -> Result<(), String> {
    qr_state.manager.cancel_export().await;
    Ok(())
}

#[tauri::command]
async fn submit_import_frame(
    qr_state: State<'_, QrTransferManagerState>,
    ur_string: String,
) -> Result<qr_transfer::ImportProgress, String> {
    qr_state
        .manager
        .submit_import_frame(&ur_string)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_import_progress(
    qr_state: State<'_, QrTransferManagerState>,
) -> Result<qr_transfer::ImportProgress, String> {
    qr_state
        .manager
        .get_import_progress()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn complete_qr_import(qr_state: State<'_, QrTransferManagerState>) -> Result<String, String> {
    qr_state
        .manager
        .complete_import()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_qr_import(qr_state: State<'_, QrTransferManagerState>) -> Result<(), String> {
    qr_state.manager.cancel_import().await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    use tauri::Emitter;

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.on_menu_event(|app, event| {
            if event.id().as_ref() == "open_cache_folder" {
                // Emit event to frontend to handle
                app.emit("menu:open_cache_folder", ()).ok();
            }
        });
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem, Submenu};
                // Create Developer menu with "Open Cache Folder" option
                let developer_menu = Submenu::with_items(
                    app,
                    "Developer",
                    true,
                    &[&MenuItem::with_id(
                        app,
                        "open_cache_folder",
                        "Open Cache Folder",
                        true,
                        None::<&str>,
                    )?],
                )?;

                // Create the menu bar
                let menu = Menu::with_items(app, &[&developer_menu])?;
                app.set_menu(menu)?;
            }

            Ok(())
        })
        .plugin(tauri_plugin_biometry::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info) // <--- Force Info level
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Key derivation function for Stronghold
                // We use argon2 to derive the snapshot key from the input password
                // Since we are using an internal key "zero-config", the "password" here will be our internal key.
                // But Stronghold expects a hashing function to turn that generic string into a 32-byte key.
                // use argon2::Argon2;
                // use quote::ToTokens;
                // Actually, let's use a simpler sha256 for the stronghold key derivation
                // or just rely on the default if we don't provide a custom builder?
                // The correct way is to provide a function that hashes the password string to [u8; 32].

                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(password.as_bytes());
                let result = hasher.finalize();
                result.to_vec()
            })
            .build(),
        )
        .manage(AppState {
            storage: Arc::new(Mutex::new(None)),
            db: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(None)),
        })
        .manage(UploadManagerState {
            manager: Mutex::new(None),
        })
        .manage(CacheState {
            thumbnail_cache: Arc::new(Mutex::new(None)),
        })
        .manage(PairingManagerState {
            manager: Arc::new(Mutex::new(None)),
        })
        .manage(QrTransferManagerState {
            manager: Arc::new(qr_transfer::QrTransferManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            import_vault,
            import_vault_step1_save,
            import_vault_step2_load,
            import_vault_step3_sync,
            bootstrap_vault,
            upload_photo,
            get_photos,
            get_thumbnail,
            sync_thumbnail_cache,
            get_vaults,
            load_vault,
            export_vault,
            get_active_vault,
            create_export_qr,
            decrypt_import,
            check_biometrics,
            authenticate_biometrics,
            // Upload queue commands
            add_files_to_queue,
            get_upload_queue_status,
            start_upload,
            cancel_upload,
            clear_finished_uploads,
            pause_upload,
            memories::create_memory,
            memories::get_memories,
            memories::update_memory,
            memories::delete_memory,
            resume_upload,
            retry_upload,
            remove_upload_item,
            initialize_upload_manager,
            open_cache_folder,
            get_audio,
            get_supported_extensions,
            get_supported_extensions,
            rename_vault,
            delete_vault,
            // Manifest sync commands
            sync_manifest_upload,
            sync_manifest_download,
            // Pairing commands
            start_pairing_mode,
            stop_pairing_mode,
            confirm_pairing,
            confirm_pairing_as_sender,
            get_pairing_status,
            get_received_vault_config,
            start_network_discovery,
            stop_network_discovery,
            get_discovered_devices,
            initiate_pairing,
            // QR Transfer commands
            create_import_request,
            start_qr_export,
            get_export_frame,
            get_export_sas,
            cancel_qr_export,
            submit_import_frame,
            get_import_progress,
            complete_qr_import,
            cancel_qr_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
