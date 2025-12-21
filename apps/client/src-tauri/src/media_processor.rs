//! Media processing module using FFmpeg sidecar for format normalization
//!
//! This module implements the processing pipelines defined in docs/MediaProcessing.md:
//! - Images: WebP at quality 90 (original), quality 70 thumbnails (max 720px)
//! - Videos: H.265 MP4 at CRF 23, animated WebP thumbnail (320px)
//! - Audio: Opus at 64kbps

use anyhow::{Context, Result};
use std::path::Path;

/// Maximum dimension for thumbnails (either width or height)
const THUMBNAIL_MAX_DIM: u32 = 720;

/// Result of processing any media file
pub struct ProcessedMedia {
    /// Encoded original file bytes
    pub original: Vec<u8>,
    /// S3 key for original (e.g., "originals/images/2024/12/{id}.webp")
    #[allow(dead_code)]
    pub original_extension: String,
    /// Encoded thumbnail bytes (images and videos only)
    pub thumbnail: Option<Vec<u8>>,
    /// Animated preview bytes (videos only) - Deprecated, mapped to thumbnail
    #[allow(dead_code)]
    pub preview: Option<Vec<u8>>,
    /// Media width in pixels
    pub width: u32,
    /// Media height in pixels
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct VideoMetadata {
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
}

/// Initialize FFmpeg (call once at startup)
/// No-op now as we use sidecar
#[allow(dead_code)]
pub fn init() -> Result<()> {
    Ok(())
}

#[allow(dead_code)]
pub fn is_available() -> bool {
    true // Assumes sidecar is bundled
}

/// Trait to abstract FFmpeg execution (Sidecar vs System)
#[async_trait::async_trait]
pub trait Transcoder: Send + Sync {
    async fn run_ffmpeg(&self, args: &[String]) -> Result<Vec<u8>>;
    async fn get_video_metadata(&self, path: &Path) -> Result<VideoMetadata>;
}

/// Implementation for Tauri App (Production) - Uses Sidecar
pub struct TauriTranscoder {
    pub app: tauri::AppHandle,
}

#[async_trait::async_trait]
impl Transcoder for TauriTranscoder {
    async fn run_ffmpeg(&self, args: &[String]) -> Result<Vec<u8>> {
        use tauri_plugin_shell::ShellExt;

        log::info!("Executing Sidecar FFmpeg command with args: {:?}", args);

        let output_path = args.last().unwrap();

        let output_result = self
            .app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| anyhow::anyhow!("Failed to create sidecar command: {}", e))?
            .args(args)
            .output()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to execute sidecar: {}", e))?;

        if !output_result.status.success() {
            let stderr = String::from_utf8_lossy(&output_result.stderr);
            log::info!("FFmpeg Sidecar stderr: {}", stderr);
            return Err(anyhow::anyhow!("FFmpeg transcode failed: {}", stderr));
        }

        std::fs::read(output_path).context("Failed to read transcoded file")
    }

    async fn get_video_metadata(&self, path: &Path) -> Result<VideoMetadata> {
        use tauri_plugin_shell::ShellExt;

        // Run ffmpeg -i input
        let output_result = self
            .app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| anyhow::anyhow!("Failed to create sidecar command: {}", e))?
            .args(&["-i", path.to_str().unwrap()])
            .output()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to execute sidecar: {}", e))?;

        // Expect failure (exit code 1) but capture stderr
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        parse_ffmpeg_stderr(&stderr)
    }
}

/// Implementation for System (Benchmark/Test) - Uses std::process::Command
pub struct SystemTranscoder;

#[async_trait::async_trait]
impl Transcoder for SystemTranscoder {
    async fn run_ffmpeg(&self, args: &[String]) -> Result<Vec<u8>> {
        log::info!("Executing System FFmpeg command with args: {:?}", args);

        let output_path = args.last().unwrap();

        let output = std::process::Command::new("ffmpeg")
            .args(args)
            .output()
            .context("Failed to execute ffmpeg command")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::info!("FFmpeg System stderr: {}", stderr);
            return Err(anyhow::anyhow!("FFmpeg transcode failed: {}", stderr));
        }

        std::fs::read(output_path).context("Failed to read transcoded file")
    }

    async fn get_video_metadata(&self, path: &Path) -> Result<VideoMetadata> {
        let output = std::process::Command::new("ffmpeg")
            .arg("-i")
            .arg(path)
            .output()
            .context("Failed to execute ffmpeg command")?;
        
        let stderr = String::from_utf8_lossy(&output.stderr);
        parse_ffmpeg_stderr(&stderr)
    }
}

fn parse_ffmpeg_stderr(stderr: &str) -> Result<VideoMetadata> {
    let mut duration = 0.0;
    let mut width = 0;
    let mut height = 0;

    for line in stderr.lines() {
        let line = line.trim();
        // Parse Duration
        if line.starts_with("Duration:") {
            // Format: Duration: 00:00:00.00, ...
            if let Some(time_str) = line.split(',').next().and_then(|s| s.strip_prefix("Duration: ")) {
                let parts: Vec<&str> = time_str.trim().split(':').collect();
                if parts.len() == 3 {
                    let h: f64 = parts[0].parse().unwrap_or(0.0);
                    let m: f64 = parts[1].parse().unwrap_or(0.0);
                    let s: f64 = parts[2].parse().unwrap_or(0.0);
                    duration = h * 3600.0 + m * 60.0 + s;
                }
            }
        }
        // Parse Dimensions from Stream line
        // Format: Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720 [SAR 1:1 DAR 16:9], 1205 kb/s, 24 fps, 24 tbr, 12288 tbn, 48 tbc
        if line.contains("Video:") {
            // Look for "1280x720" pattern
            // Crude parsing: split by commas, find one with 'x' inside
            let parts: Vec<&str> = line.split(',').collect();
            for part in parts {
                let part = part.trim();
                // Check if part matches digits x digits
                if let Some(x_pos) = part.find('x') {
                    let (w_str, h_str) = part.split_at(x_pos);
                    let h_str = &h_str[1..]; // skip 'x'
                    
                    // cleanup " [SAR..." from height if present
                    let h_str = h_str.split_whitespace().next().unwrap_or(h_str);

                    if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
                        width = w;
                        height = h;
                        // Avoid false positives (small numbers)
                        if w > 0 && h > 0 {
                            break;
                        }
                    }
                }
            }
        }
    }

    if width == 0 || height == 0 {
        // Fallback or warning?
        log::info!("Warning: Could not parse video dimensions from ffmpeg output");
    }

    Ok(VideoMetadata {
        duration_seconds: duration,
        width,
        height,
    })
}

/// Process an image file: create WebP original and thumbnail
/// Uses image crate directly for reliability
pub fn process_image(path: &Path) -> Result<ProcessedMedia> {
    use image::GenericImageView;

    // Load image using image crate
    let img = image::open(path).context("Failed to open image")?;

    let (width, height) = img.dimensions();

    // Create original WebP (Q90)
    let original_buf = {
        let rgb = img.to_rgb8();
        let encoder = webp::Encoder::from_rgb(rgb.as_raw(), width, height);
        let webp_memory = encoder.encode(90.0);
        webp_memory.to_vec()
    };

    // Create thumbnail (Q70)
    let (thumb_width, thumb_height) =
        calculate_thumbnail_dimensions(width, height, THUMBNAIL_MAX_DIM);
    let thumbnail_img = img.resize(
        thumb_width,
        thumb_height,
        image::imageops::FilterType::Lanczos3,
    );

    let (actual_thumb_width, actual_thumb_height) = thumbnail_img.dimensions();

    let thumbnail_buf = {
        let rgb_image = thumbnail_img.to_rgb8();
        let encoder =
            webp::Encoder::from_rgb(rgb_image.as_raw(), actual_thumb_width, actual_thumb_height);
        let webp_memory = encoder.encode(70.0);
        webp_memory.to_vec()
    };

    Ok(ProcessedMedia {
        original: original_buf,
        original_extension: "webp".to_string(),
        thumbnail: Some(thumbnail_buf),
        preview: None,
        width,
        height,
    })
}

/// Process a video file: create H.265 MP4 and animated WebP thumbnail
pub async fn process_video(
    transcoder: &impl Transcoder,
    path: &Path,
    output_path: &Path,
) -> Result<ProcessedMedia> {
    // 1. Get Metadata
    let metadata = transcoder.get_video_metadata(path).await?;
    
    // 2. Generate Animated Thumbnail (WebP sidecar)
    // We want ~8 frames. Calculate FPS needed.
    // If duration is 0 (parsing failed), fallback to 1 fps.
    let duration = if metadata.duration_seconds > 0.0 { metadata.duration_seconds } else { 10.0 };
    let target_fps = 8.0 / duration;
    
    // Clap FPS reasonable bounds (e.g. at least 0.1 fps, max 5 fps)
    let fps_arg = format!("fps={:.4},scale=320:-1:flags=lanczos", target_fps.max(0.1).min(5.0));

    let thumb_out_path = output_path.with_file_name("thumb_temp.webp");
    
    let thumb_args = vec![
        "-i".to_string(),
        path.to_string_lossy().to_string(),
        "-vf".to_string(),
        fps_arg,
        "-vframes".to_string(),
        "8".to_string(), // Cap at 8 frames
        "-loop".to_string(),
        "0".to_string(),
        "-an".to_string(),
        "-preset".to_string(),
        "default".to_string(),
        "-y".to_string(),
        thumb_out_path.to_string_lossy().to_string(),
    ];

    let thumbnail_bytes = match transcoder.run_ffmpeg(&thumb_args).await {
        Ok(bytes) => Some(bytes),
        Err(e) => {
            log::info!("Failed to generate video thumbnail: {}", e);
            None
        }
    };
    
    // Clean up temp file (bytes already read into memory by run_ffmpeg helper?? 
    // Wait, run_ffmpeg reads the file. So it's fine.)
    // But run_ffmpeg reads "output_path". Here output_path is `thumb_out_path`.
    // I should delete it after reading? `run_ffmpeg` reads it, but doesn't delete it.
    // Ideally I should delete it. 
    // But usage pattern in this app is unusual: run_ffmpeg returns bytes.
    if thumb_out_path.exists() {
        let _ = std::fs::remove_file(&thumb_out_path);
    }

    // 3. Transcode to H.265
    let original = transcode_video_h265(transcoder, path, output_path).await?;

    Ok(ProcessedMedia {
        original,
        original_extension: "mp4".to_string(),
        thumbnail: thumbnail_bytes,
        preview: None,
        width: metadata.width,
        height: metadata.height,
    })
}

/// Process an audio file: convert to Opus
pub async fn process_audio(
    transcoder: &impl Transcoder,
    path: &Path,
    output_path: &Path,
) -> Result<ProcessedMedia> {
    let original = transcode_audio_opus(transcoder, path, output_path).await?;

    Ok(ProcessedMedia {
        original,
        original_extension: "opus".to_string(),
        thumbnail: None,
        preview: None,
        width: 0,
        height: 0,
    })
}

// ============ Helper Functions ============

/// Calculate thumbnail dimensions maintaining aspect ratio
fn calculate_thumbnail_dimensions(width: u32, height: u32, max_dim: u32) -> (u32, u32) {
    if width <= max_dim && height <= max_dim {
        let new_w = (width as f32 * 0.5) as u32;
        let new_h = (height as f32 * 0.5) as u32;
        if new_w < 200 || new_h < 200 {
            return (width, height);
        }
        return (new_w, new_h);
    }

    let ratio = width as f32 / height as f32;
    if width > height {
        (max_dim, (max_dim as f32 / ratio) as u32)
    } else {
        ((max_dim as f32 * ratio) as u32, max_dim)
    }
}

/// Transcode video to H.265 MP4 using Generic Transcoder
async fn transcode_video_h265(
    transcoder: &impl Transcoder,
    input_path: &Path,
    output_path: &Path,
) -> Result<Vec<u8>> {
    let args = vec![
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-c:v".to_string(),
        "libx265".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-preset".to_string(),
        "slow".to_string(),
        "-tag:v".to_string(),
        "hvc1".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "64k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-map_metadata".to_string(),
        "0".to_string(),
        "-y".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    transcoder.run_ffmpeg(&args).await
}

/// Transcode audio to Opus using Generic Transcoder
async fn transcode_audio_opus(
    transcoder: &impl Transcoder,
    input_path: &Path,
    output_path: &Path,
) -> Result<Vec<u8>> {
    let args = vec![
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-c:a".to_string(),
        "libopus".to_string(),
        "-b:a".to_string(),
        "64k".to_string(),
        "-vn".to_string(),
        "-map_metadata".to_string(),
        "0".to_string(),
        "-y".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    transcoder.run_ffmpeg(&args).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thumbnail_dimensions() {
        let (w, h) = calculate_thumbnail_dimensions(1920, 1080, 720);
        assert_eq!(w, 720);
        assert!(h <= 720);
        let (w, h) = calculate_thumbnail_dimensions(1080, 1920, 720);
        assert!(w <= 720);
        assert_eq!(h, 720);
        let (w, h) = calculate_thumbnail_dimensions(400, 300, 720);
        assert_eq!(w, 400);
        assert_eq!(h, 300);
    }
}
