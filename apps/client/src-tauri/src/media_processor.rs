//! Media processing module using FFmpeg sidecar for format normalization
//!
//! This module implements the processing pipelines defined in docs/MediaProcessing.md:
//! - Images: WebP at quality 90 (original), quality 70 thumbnails (max 720px)
//! - Videos: H.265 MP4 at CRF 23, animated WebP thumbnail (320px)
//! - Audio: Opus at 64kbps

use anyhow::{Context, Result};
use std::path::Path;
use image::GenericImageView;

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

#[derive(Debug, Clone, Default)]
pub struct VideoMetadata {
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub make: Option<String>,
    pub model: Option<String>,
    pub creation_time: Option<String>,
    pub location: Option<String>,
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
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return Err(anyhow::anyhow!("FFmpeg sidecar is not available on mobile."));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
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
    }

    async fn get_video_metadata(&self, path: &Path) -> Result<VideoMetadata> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return Err(anyhow::anyhow!("FFmpeg sidecar is not available on mobile."));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
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
            log::warn!("ffmpeg-stderr: {}", stderr);
            parse_ffmpeg_stderr(&stderr)
        }
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
    let mut meta = VideoMetadata::default();

    for line in stderr.lines() {
        let line = line.trim();
        
        // Parse Duration
        if line.starts_with("Duration:") {
            if let Some(time_str) = line.split(',').next().and_then(|s| s.strip_prefix("Duration: ")) {
                let parts: Vec<&str> = time_str.trim().split(':').collect();
                if parts.len() == 3 {
                    let h: f64 = parts[0].parse().unwrap_or(0.0);
                    let m: f64 = parts[1].parse().unwrap_or(0.0);
                    let s: f64 = parts[2].parse().unwrap_or(0.0);
                    meta.duration_seconds = h * 3600.0 + m * 60.0 + s;
                }
            }
        }
        
        // Parse Dimensions
        if line.contains("Video:") {
            let parts: Vec<&str> = line.split(',').collect();
            for part in parts {
                let part = part.trim();
                if let Some(x_pos) = part.find('x') {
                    let (w_str, h_str) = part.split_at(x_pos);
                    let h_str = &h_str[1..];
                    let h_str = h_str.split_whitespace().next().unwrap_or(h_str);

                    if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
                        meta.width = w;
                        meta.height = h;
                        if w > 0 && h > 0 { break; }
                    }
                }
            }
        }

        // Parse Metadata Keys (Case insensitive check might be safer but FFmpeg output is usually lower case keys)
        // Note: FFmpeg prints metadata keys with various prefixes depending on the container (e.g. com.apple.quicktime...)
        
        if let Some(val) = get_metadata_value(line, "make") { meta.make = Some(val); }
        if let Some(val) = get_metadata_value(line, "model") { meta.model = Some(val); }
        if let Some(val) = get_metadata_value(line, "creation_time") { meta.creation_time = Some(val); }
        if let Some(val) = get_metadata_value(line, "creationdate") { meta.creation_time = Some(val); } // Apple specific
        if let Some(val) = get_metadata_value(line, "location.ISO6709") { meta.location = Some(val); }
        if let Some(val) = get_metadata_value(line, "location") { 
            if meta.location.is_none() { meta.location = Some(val); }
        }
    }

    Ok(meta)
}

fn get_metadata_value(line: &str, key_suffix: &str) -> Option<String> {
    // Matches "key : value" where key ends with key_suffix (case insensitive)
    // E.g. "com.apple.quicktime.make: Apple"
    if let Some(idx) = line.find(':') {
        let (key_part, val_part) = line.split_at(idx);
        let key = key_part.trim().to_lowercase();
        let suffix = key_suffix.to_lowercase();
        // Check if key ends with the suffix (ignoring namespaces)
        if key == suffix || key.ends_with(&format!(".{}", suffix)) {
            return Some(val_part[1..].trim().to_string());
        }
    }
    None
}

const THUMBNAIL_QUALITY: f32 = 70.0;

/// Shared helper to resize and process a frame/image for thumbnailing
fn resize_and_process_frame(img: &image::DynamicImage, max_dim: u32) -> Result<(u32, u32, image::RgbaImage)> {
    let (width, height) = img.dimensions();
    let (target_w, target_h) = calculate_thumbnail_dimensions(width, height, max_dim);
    
    let resized = img.resize_exact(target_w, target_h, image::imageops::FilterType::Lanczos3);
    Ok((target_w, target_h, resized.to_rgba8()))
}

/// Process an image file: create WebP original and thumbnail
/// Uses image crate directly for reliability, with FFmpeg fallback
pub async fn process_image(
    transcoder: &impl Transcoder,
    path: &Path,
) -> Result<ProcessedMedia> {
    use image::GenericImageView;

    // Load image using image crate, with FFmpeg fallback
    let img = match image::open(path) {
        Ok(i) => i,
        Err(e) => {
            log::warn!("Failed to open image directly ({}); attempting FFmpeg fallback...", e);
            
            let temp_dir = std::env::temp_dir();
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let temp_png = temp_dir.join(format!("fallback_{}.png", millis));
            
            let args = vec![
                "-i".to_string(),
                path.to_string_lossy().to_string(),
                "-y".to_string(),
                temp_png.to_string_lossy().to_string(),
            ];
            
            transcoder.run_ffmpeg(&args).await.context("FFmpeg fallback conversion failed")?;
            
            let i = image::open(&temp_png).context("Failed to open fallback PNG")?;
            std::fs::remove_file(&temp_png).ok();
            i
        }
    };

    let (width, height) = img.dimensions();

    // Create original WebP (Q90)
    let original_buf = {
        let rgb = img.to_rgb8();
        let encoder = webp::Encoder::from_rgb(rgb.as_raw(), width, height);
        let webp_memory = encoder.encode(90.0);
        webp_memory.to_vec()
    };

    // Create thumbnail using shared logic
    let (thumb_w, thumb_h, thumb_rgba) = resize_and_process_frame(&img, THUMBNAIL_MAX_DIM)?;

    let thumbnail_buf = {
        let encoder = webp::Encoder::from_rgba(thumb_rgba.as_raw(), thumb_w, thumb_h);
        let webp_memory = encoder.encode(THUMBNAIL_QUALITY);
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
// Helper to create animated WebP from frames
fn create_animated_thumbnail(frames: Vec<Vec<u8>>) -> Result<Vec<u8>> {
    use webp_animation::{Encoder, EncoderOptions, EncodingConfig};

    if frames.is_empty() {
        return Err(anyhow::anyhow!("No frames provided for animated thumbnail"));
    }

    // Decode first frame to get dimensions
    let first_img = image::load_from_memory(&frames[0])
        .context("Failed to decode first frame")?;
    
    // Calculate dimensions using shared logic
    let (target_w, target_h, _) = resize_and_process_frame(&first_img, 320)?;

    // Configure Encoder
    let mut encoder = Encoder::new_with_options((target_w, target_h), EncoderOptions {
        encoding_config: Some(EncodingConfig {
            quality: THUMBNAIL_QUALITY, // Shared constant 70.0
            ..Default::default()
        }),
        ..Default::default()
    })?;

    let frame_duration_ms = 1000 / 6; // ~6 FPS (user requested 6 frames)
    let mut timestamp_ms = 0;

    for frame_bytes in frames {
        let img = image::load_from_memory(&frame_bytes).context("Failed to decode frame")?;
        
        // Use shared resize logic
        let (_, _, rgba) = resize_and_process_frame(&img, 320)?;

        encoder.add_frame(&rgba, timestamp_ms)?;
        timestamp_ms += frame_duration_ms;
    }

    let webp_data = encoder.finalize(timestamp_ms)?;
    Ok(webp_data.to_vec())
}

/// Process a video file: create H.265 MP4 and animated WebP thumbnail
/// Mobile: Skip transcode, use provided frames for thumbnail
/// Desktop: Transcode (Fast), use provided frames OR sidecar for thumbnail
pub async fn process_video(
    transcoder: &impl Transcoder,
    path: &Path,
    output_path: &Path,
    pre_generated_frames: Option<Vec<Vec<u8>>>,
) -> Result<ProcessedMedia> {
    
    // 1. Generate Thumbnail (Platform agnostic if frames provided)
    let thumbnail_bytes = if let Some(frames) = pre_generated_frames {
        log::info!("Generating animated thumbnail from {} frontend frames", frames.len());
        match create_animated_thumbnail(frames) {
            Ok(bytes) => Some(bytes),
            Err(e) => {
                log::warn!("Failed to create animated thumbnail from frames: {}", e);
                None
            }
        }
    } else {
        // Fallback: Desktop uses FFmpeg
        #[cfg(desktop)]
        {
             // 1. Get Metadata (Only needed if we are generating thumbnail via FFmpeg)
             let metadata = transcoder.get_video_metadata(path).await?;
             // ... Logic to generate via FFmpeg (see below)
             // We can refactor existing logic here, but for now let's keep it simple
             
             generate_thumbnail_ffmpeg(transcoder, path, output_path, metadata).await
        }
        #[cfg(not(desktop))] // Mobile
        {
            log::warn!("No pre-generated frames provided on Mobile. Video will have no thumbnail.");
            None
        }
    };

    // 2. Transcode Video (Platform Specific)
    #[cfg(desktop)]
    let (original, ext) = {
        let bytes = transcode_video_h265(transcoder, path, output_path).await?;
        (bytes, "mp4".to_string())
    };

    #[cfg(not(desktop))] // mobile
    let (original, ext) = {
        log::info!("Mobile: Skipping video transcoding, using original file");
        let bytes = std::fs::read(path).context("Failed to read video file")?;
        // Detect original extension
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4")
            .to_string();
        (bytes, ext)
    };

    // Get dimensions if possible (for metadata)
    // On desktop we might have them from FFmpeg. On mobile/desktop we can try to guess or use 0
    // If we have thumbnail, use its dims?
    // Let's implement a lighter metadata reader if needed, for now 0 is acceptable fallback
    let (width, height) = (0, 0); 
    // Optimization: we could use the frame dimensions if we decode them?

    Ok(ProcessedMedia {
        original,
        original_extension: ext,
        thumbnail: thumbnail_bytes,
        preview: None,
        width, // Todo: Improve metadata extraction on Mobile without FFmpeg
        height,
    })
}

// Extracted FFmpeg thumbnail logic (Desktop only helper)
#[cfg(desktop)]
async fn generate_thumbnail_ffmpeg(
    transcoder: &impl Transcoder,
    path: &Path,
    output_path: &Path,
    metadata: VideoMetadata,
) -> Option<Vec<u8>> {
    let duration = if metadata.duration_seconds > 0.0 { metadata.duration_seconds } else { 10.0 };
    let target_fps = 8.0 / duration;
    let fps_arg = format!("fps={:.4},scale=320:-1:flags=lanczos", target_fps.max(0.1).min(5.0));

    let thumb_out_path = output_path.with_file_name("thumb_temp.webp");
    
    let thumb_args = vec![
        "-i".to_string(),
        path.to_string_lossy().to_string(),
        "-vf".to_string(),
        fps_arg,
        "-vframes".to_string(),
        "8".to_string(),
        "-loop".to_string(),
        "0".to_string(),
        "-an".to_string(),
        "-preset".to_string(),
        "default".to_string(),
        "-y".to_string(),
        thumb_out_path.to_string_lossy().to_string(),
    ];

    let res = match transcoder.run_ffmpeg(&thumb_args).await {
        Ok(bytes) => Some(bytes),
        Err(e) => {
            log::info!("Failed to generate video thumbnail: {}", e);
            None
        }
    };
    if thumb_out_path.exists() { let _ = std::fs::remove_file(&thumb_out_path); }
    res
}

/// Process an audio file: convert to Opus
pub async fn process_audio(
    transcoder: &impl Transcoder,
    path: &Path,
    output_path: &Path,
) -> Result<ProcessedMedia> {
    #[cfg(desktop)]
    let (original, ext) = {
        let bytes = transcode_audio_opus(transcoder, path, output_path).await?;
        (bytes, "opus".to_string())
    };

    #[cfg(not(desktop))]
    let (original, ext) = {
        let bytes = std::fs::read(path).context("Failed to read audio file")?;
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("opus")
            .to_string();
        (bytes, ext)
    };

    Ok(ProcessedMedia {
        original,
        original_extension: ext,
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
        "fast".to_string(),
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
