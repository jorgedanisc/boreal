mod crypto;
mod db;
mod image_processing;
mod storage;
mod vault;

use crate::storage::Storage;
use crate::vault::VaultConfig;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

struct AppState {
    storage: Mutex<Option<Storage>>,
    db: Mutex<Option<Connection>>,
    config: Mutex<Option<VaultConfig>>,
}

// Commands

#[tauri::command]
async fn import_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    vault_code: String,
) -> Result<(), String> {
    let config: VaultConfig =
        serde_json::from_str(&vault_code).map_err(|e| format!("Invalid vault code: {}", e))?;

    // Validate key
    let _ = BASE64
        .decode(&config.vault_key)
        .map_err(|e| format!("Invalid vault key encoding: {}", e))?;

    // Setup Storage
    let storage = Storage::new(&config).await;

    // Setup DB
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let db_path = app_dir.join("manifest.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    // Save config to disk (WARNING: Plaintext for Phase 1. Should use Keychain)
    let config_path = app_dir.join("vault.json");
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path, config_json).map_err(|e| e.to_string())?;

    // Update State
    *state.storage.lock().await = Some(storage);
    *state.db.lock().await = Some(conn);
    *state.config.lock().await = Some(config);

    Ok(())
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
async fn get_thumbnail(state: State<'_, AppState>, id: String) -> Result<String, String> {
    // Returns Base64
    let config_guard = state.config.lock().await;
    let config = config_guard.as_ref().ok_or("Vault not loaded")?;

    let storage_guard = state.storage.lock().await;
    let storage = storage_guard.as_ref().ok_or("Storage not initialized")?;

    // Try to read from S3 (Phase 1 simplistic: always download)
    // TODO: Local Cache

    let thumbnail_key = format!("thumbnails/{}.avif", id);
    let enc_bytes = storage
        .download_file(&thumbnail_key)
        .await
        .map_err(|e| e.to_string())?;

    // Decrypt
    let vault_key = BASE64.decode(&config.vault_key).unwrap();
    let key_arr: [u8; 32] = vault_key.try_into().map_err(|_| "Invalid key length")?;

    let dec_bytes = crypto::decrypt(&enc_bytes, &key_arr).map_err(|e| e.to_string())?;

    // Convert to Base64 for frontend
    Ok(BASE64.encode(&dec_bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            storage: Mutex::new(None),
            db: Mutex::new(None),
            config: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            import_vault,
            upload_photo,
            get_photos,
            get_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
