// Model path utilities for bundled ONNX models
// Models are stored in the app_data_dir/models directory

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use std::io::Write;
use futures_util::StreamExt;

// Define Model Specs here
const MODEL_SPECS: &[(&str, &str, u64)] = &[
    (
        "https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5/resolve/main/model.onnx",
        "vision-model.onnx",
        236000000, 
    ),
    (
        "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/model.onnx",
        "text-model.onnx",
        137000000,
    ),
    (
        "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/tokenizer.json",
        "tokenizer.json",
        2000000,
    ),
];

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    filename: String,
    downloaded: u64,
    total: u64,
}

/// Get paths for downloaded model files
/// Models are stored in the app_data_dir/models directory
pub fn get_model_paths(app_data_dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let models_dir = app_data_dir.join("models");
    let vision_path = models_dir.join("vision-model.onnx");
    let text_path = models_dir.join("text-model.onnx");
    let tokenizer_path = models_dir.join("tokenizer.json");
    (vision_path, text_path, tokenizer_path)
}

/// Check if all model files exist
pub fn models_exist(app_data_dir: &Path) -> bool {
    let (vision, text, tokenizer) = get_model_paths(app_data_dir);
    vision.exists() && text.exists() && tokenizer.exists()
}

#[tauri::command]
pub async fn download_models(app: AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models_dir = app_dir.join("models");

    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }

    for (url, filename, size) in MODEL_SPECS {
        let file_path = models_dir.join(filename);
        let file_path_str = file_path.to_string_lossy().to_string();

        if file_path.exists() {
             // Optional: Check size or hash to confirm validity? 
             // For now, if it exists, we skip or we can force overwrite. 
             // Implementation plan implies "Download Logic", let's assume valid if exists 
             // OR re-download to be safe/ensure integrity? 
             // Better to check if existing file size is roughly correct or just overwrite?
             // Let's check size.
             if let Ok(metadata) = std::fs::metadata(&file_path) {
                 if metadata.len() > 0 {
                     log::info!("File {} already exists, skipping...", filename);
                     // Emit 100% for UI to know it's "done"
                     let _ = app.emit("download_progress", DownloadProgress {
                        filename: filename.to_string(),
                        downloaded: *size,
                        total: *size,
                    });
                     continue;
                 }
             }
        }

        log::info!("[Download] Starting download of {} to {}", url, file_path_str);
        
        let client = reqwest::Client::new();
        let response = client.get(*url).send().await.map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Download failed for {} with status: {}", filename, response.status()));
        }

        let total_size = response.content_length().unwrap_or(*size);
        let mut stream = response.bytes_stream();
        let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
        let mut downloaded: u64 = 0;

        // Throttle updates to avoid spamming the bridge
        let mut last_emit = std::time::Instant::now();

        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| e.to_string())?;
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed().as_millis() > 100 {
                 let _ = app.emit("download_progress", DownloadProgress {
                    filename: filename.to_string(),
                    downloaded,
                    total: total_size,
                });
                last_emit = std::time::Instant::now();
            }
        }
        
        // Final emit
        let _ = app.emit("download_progress", DownloadProgress {
            filename: filename.to_string(),
            downloaded: total_size,
            total: total_size,
        });

        log::info!("[Download] Successfully saved to {}", file_path_str);
    }
    
    Ok(())
}


