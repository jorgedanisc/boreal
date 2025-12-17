mod cache;
mod crypto;
mod db;
mod file_filter;
mod image_processing;
mod media_processor;
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
    thumbnail_cache: Mutex<Option<ThumbnailCache>>,
}

struct UploadManagerState {
    manager: Mutex<Option<UploadManager>>,
}

// Commands

use crate::vault::{store, VaultPublic};

#[tauri::command]
async fn get_vaults(app: AppHandle) -> Result<Vec<VaultPublic>, String> {
    store::get_vaults(&app)
}

#[tauri::command]
async fn load_vault(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    // 1. Get config from Stronghold
    let config = store::load_vault(&app, &id)?;

    // 2. Validate key
    let _ = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key encoding: {}", e))?;

    // 3. Setup Storage
    let storage = Storage::new(&config).await;

    // 4. Setup DB (Scoped to vault ID to support multiple vaults!)
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Create a subfolder for this vault to avoid conflict
    let vault_dir = app_dir.join("vaults").join(&config.id);
    if !vault_dir.exists() {
        std::fs::create_dir_all(&vault_dir).map_err(|e| e.to_string())?;
    }

    let db_path = vault_dir.join("manifest.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    // 5. Update State
    *state.storage.lock().await = Some(storage);
    *state.db.lock().await = Some(conn);
    *state.config.lock().await = Some(config.clone());

    Ok(())
}

#[tauri::command]
async fn import_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    vault_code: String,
) -> Result<(), String> {
    let mut config: VaultConfig =
        serde_json::from_str(&vault_code).map_err(|e| format!("Invalid vault code: {}", e))?;

    // If imported config lacks ID/Name (legacy format?), generate them.
    if config.id.is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    if config.name.is_empty() {
        config.name = "Imported Vault".to_string();
    }

    // Save to Stronghold
    store::save_vault(&app, &config)?;

    // Activate
    load_vault(app, state, config.id).await
}

#[tauri::command]
async fn bootstrap_vault(
    app: AppHandle,
    state: State<'_, AppState>,
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

    // 3. Create full config
    let id = uuid::Uuid::new_v4().to_string();
    let config = VaultConfig::new(
        id.clone(),
        "My Vault".to_string(), // Default name, user can rename later
        bootstrap.access_key_id,
        bootstrap.secret_access_key,
        bootstrap.region,
        bootstrap.bucket,
        BASE64.encode(kek),
    );

    // 4. Setup Storage & Upload Encrypted Key (We need to init storage temporarily)
    let storage = Storage::new(&config).await;
    storage
        .upload_file("vault-key.enc", enc_vault_key)
        .await
        .map_err(|e| format!("Failed to upload vault key: {}", e))?;

    // 5. Save to Stronghold
    store::save_vault(&app, &config)?;

    // 6. Activate
    load_vault(app, state, id).await
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
    tier: String,
}

#[tauri::command]
async fn get_photos(state: State<'_, AppState>) -> Result<Vec<Photo>, String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    let mut stmt = conn
        .prepare("SELECT id, filename, created_at, tier FROM photos ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let photos = stmt
        .query_map([], |row| {
            Ok(Photo {
                id: row.get(0)?,
                filename: row.get(1)?,
                created_at: row.get(2)?,
                tier: row.get(3)?,
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

#[tauri::command]
async fn get_active_vault(state: State<'_, AppState>) -> Result<Option<VaultPublic>, String> {
    let config = state.config.lock().await;
    match config.as_ref() {
        Some(c) => Ok(Some(VaultPublic {
            id: c.id.clone(),
            name: c.name.clone(),
            bucket: c.bucket.clone(),
        })),
        None => Ok(None),
    }
}

#[tauri::command]
async fn export_vault(app: AppHandle, id: String) -> Result<String, String> {
    let config = store::load_vault(&app, &id)?;
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

    // 4. Derive Key
    let key = crypto::derive_key(&pin_string, &salt);

    // 5. Encrypt (Salt + Nonce + Ciphertext)
    // crypto::encrypt already prepends Nonce. We prepend Salt manually.
    let encrypted_data = crypto::encrypt(json.as_bytes(), &key).map_err(|e| e.to_string())?;

    let mut final_blob = salt.to_vec();
    final_blob.extend(encrypted_data);

    // 6. Encode Base64
    let b64_data = BASE64.encode(final_blob);
    let url = format!("boreal://import?data={}", b64_data);

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

    // Extract Salt
    let (salt, rest) = blob.split_at(16);

    // Derive Key
    let key = crypto::derive_key(&pin, salt);

    // Decrypt (rest contains Nonce + Ciphertext, which crypto::decrypt expects)
    let plaintext =
        crypto::decrypt(rest, &key).map_err(|_| "Decryption failed. Wrong PIN?".to_string())?;

    let json = String::from_utf8(plaintext).map_err(|e| e.to_string())?;
    Ok(json)
}

// ============ Upload Queue Commands ============

#[derive(serde::Deserialize)]
struct AddFilesPayload {
    paths: Vec<String>,
    fresh_upload: bool,
}

#[derive(serde::Serialize)]
struct AddFilesResult {
    items: Vec<UploadItem>,
    fresh_upload_auto_disabled: bool,
}

#[tauri::command]
async fn add_files_to_queue(
    state: State<'_, AppState>,
    upload_state: State<'_, UploadManagerState>,
    payload: AddFilesPayload,
) -> Result<AddFilesResult, String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

    let paths: Vec<PathBuf> = payload.paths.iter().map(PathBuf::from).collect();

    // First, filter out unsupported files and create items
    let mut valid_paths = Vec::new();
    for path in paths {
        if file_filter::is_supported_media(&path) {
            valid_paths.push(path);
        }
    }

    // Create temporary items to check if we should auto-disable fresh upload
    let temp_items: Vec<UploadItem> = valid_paths
        .iter()
        .filter_map(|p| UploadItem::new(p.clone(), payload.fresh_upload).ok())
        .collect();

    let fresh_upload_auto_disabled = manager.should_disable_fresh_upload(&temp_items);

    let actual_fresh_upload = if fresh_upload_auto_disabled {
        false
    } else {
        payload.fresh_upload
    };

    // Now add with the correct fresh_upload flag
    let items = manager
        .add_files(valid_paths, actual_fresh_upload)
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

#[tauri::command]
async fn start_upload(upload_state: State<'_, UploadManagerState>) -> Result<(), String> {
    let manager_guard = upload_state.manager.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Upload manager not initialized")?;

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
async fn initialize_upload_manager(
    app: AppHandle,
    state: State<'_, AppState>,
    upload_state: State<'_, UploadManagerState>,
) -> Result<(), String> {
    let (manager, _cancel_rx) = UploadManager::new(
        app,
        state.storage.clone(),
        state.config.clone(),
        state.db.clone(),
    );
    *upload_state.manager.lock().await = Some(manager);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(AppState {
            storage: Arc::new(Mutex::new(None)),
            db: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(None)),
        })
        .manage(UploadManagerState {
            manager: Mutex::new(None),
        })
        .manage(CacheState {
            thumbnail_cache: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            import_vault,
            bootstrap_vault,
            upload_photo,
            get_photos,
            get_thumbnail,
            get_vaults,
            load_vault,
            export_vault,
            get_active_vault,
            create_export_qr,
            decrypt_import,
            // Upload queue commands
            add_files_to_queue,
            get_upload_queue_status,
            start_upload,
            cancel_upload,
            clear_finished_uploads,
            pause_upload,
            resume_upload,
            retry_upload,
            initialize_upload_manager
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
