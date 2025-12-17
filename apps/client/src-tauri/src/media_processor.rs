//! Media processing module using FFmpeg for format normalization
//!
//! This module implements the processing pipelines defined in docs/MediaProcessing.md:
//! - Images: WebP at quality 90 (original), quality 70 thumbnails (max 720px)
//! - Videos: H.265 MP4 at CRF 18, static WebP thumbnail, animated WebP preview
//! - Audio: Opus at 128kbps

use anyhow::{Context, Result};
use std::path::Path;

extern crate ffmpeg_next as ffmpeg;

use ffmpeg::codec;
use ffmpeg::format;
use ffmpeg::frame;
use ffmpeg::media::Type;
use ffmpeg::software::scaling::{context::Context as ScalingContext, flag::Flags as ScalingFlags};

/// Maximum dimension for thumbnails (either width or height)
const THUMBNAIL_MAX_DIM: u32 = 720;
/// Number of frames for animated video preview
const PREVIEW_FRAME_COUNT: usize = 8;

/// Result of processing any media file
pub struct ProcessedMedia {
    /// Encoded original file bytes
    pub original: Vec<u8>,
    /// S3 key for original (e.g., "originals/images/2024/12/{id}.webp")
    pub original_extension: String,
    /// Encoded thumbnail bytes (images and videos only)
    pub thumbnail: Option<Vec<u8>>,
    /// Animated preview bytes (videos only)
    pub preview: Option<Vec<u8>>,
    /// Media width in pixels
    pub width: u32,
    /// Media height in pixels
    pub height: u32,
}

/// Initialize FFmpeg (call once at startup)
pub fn init() -> Result<()> {
    ffmpeg::init().context("Failed to initialize FFmpeg")?;
    Ok(())
}

/// Check if FFmpeg is available and properly initialized
pub fn is_available() -> bool {
    ffmpeg::init().is_ok()
}

/// Process an image file: create WebP original and thumbnail
/// Uses image crate directly for reliability (FFmpeg has issues with some formats)
/// Thumbnail uses lossy encoding with quality 70 for ~30-40KB file sizes
pub fn process_image(path: &Path) -> Result<ProcessedMedia> {
    use image::GenericImageView;

    // Load image using image crate
    let img = image::open(path).context("Failed to open image")?;

    let (width, height) = img.dimensions();

    // Create original WebP with high quality lossy encoding (Q90)
    // Lossless (used previously) causes massive inflation for lossy inputs (JPEG etc)
    let original_buf = {
        let rgb = img.to_rgb8();
        let encoder = webp::Encoder::from_rgb(rgb.as_raw(), width, height);
        // Quality 90 is visually near-lossless but much more efficient for photos
        let webp_memory = encoder.encode(90.0);
        webp_memory.to_vec()
    };

    // Create thumbnail with LOSSY encoding for small file sizes (~30-40KB target)
    let (thumb_width, thumb_height) =
        calculate_thumbnail_dimensions(width, height, THUMBNAIL_MAX_DIM);
    let thumbnail_img = img.resize(
        thumb_width,
        thumb_height,
        image::imageops::FilterType::Lanczos3,
    );

    // Get actual dimensions after resize
    let (actual_thumb_width, actual_thumb_height) = thumbnail_img.dimensions();

    // Use webp crate for LOSSY encoding with quality 70
    // This is the key change - lossless was producing 200-400KB, lossy produces ~30-40KB
    let thumbnail_buf = {
        let rgb_image = thumbnail_img.to_rgb8();
        let encoder =
            webp::Encoder::from_rgb(rgb_image.as_raw(), actual_thumb_width, actual_thumb_height);
        // Quality 70 gives excellent visual quality with small file size
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

/// Process a video file: create H.265 MP4 and animated WebP thumbnail (no static)
pub async fn process_video(
    app: &tauri::AppHandle,
    path: &Path,
    output_path: &Path,
) -> Result<ProcessedMedia> {
    let mut ictx = format::input(path).context("Failed to open input video")?;

    // Extract stream metadata before any mutable borrows
    let (video_stream_index, time_base, duration, decoder_params) = {
        let video_stream = ictx
            .streams()
            .best(Type::Video)
            .ok_or_else(|| anyhow::anyhow!("No video stream found"))?;

        let index = video_stream.index();
        let tb = video_stream.time_base();
        let dur = video_stream.duration() as f64 * f64::from(tb);
        let params = video_stream.parameters();
        (index, tb, dur, params)
    };

    // Calculate preview frame timestamps (middle 90%, skip first/last 5%)
    let preview_start = duration * 0.05;
    let preview_end = duration * 0.95;
    let preview_interval = (preview_end - preview_start) / PREVIEW_FRAME_COUNT as f64;

    let context_decoder = codec::context::Context::from_parameters(decoder_params)?;
    let mut decoder = context_decoder.decoder().video()?;
    let width = decoder.width();
    let height = decoder.height();

    let mut preview_frames: Vec<frame::Video> = Vec::with_capacity(PREVIEW_FRAME_COUNT);

    // Seek to start of preview section
    ictx.seek((preview_start * 1_000_000.0) as i64, ..)?;

    for (stream, packet) in ictx.packets() {
        if stream.index() == video_stream_index {
            decoder.send_packet(&packet)?;
            let mut decoded = frame::Video::empty();
            while decoder.receive_frame(&mut decoded).is_ok() {
                // Collect preview frames for the animated thumbnail
                let frame_ts = decoded.timestamp().unwrap_or(0) as f64 * f64::from(time_base);

                // Check if we have enough frames
                if preview_frames.len() >= PREVIEW_FRAME_COUNT {
                    break;
                }

                // Check if likely duplicate or too close (simple interval check)
                if frame_ts >= preview_start {
                    let expected_ts =
                        preview_start + (preview_frames.len() as f64 * preview_interval);

                    // Allow some tolerance or just take the next available frame after expected timestamp
                    if frame_ts >= expected_ts {
                        preview_frames.push(decoded.clone());
                    }
                }
            }
        }

        if preview_frames.len() >= PREVIEW_FRAME_COUNT {
            break;
        }
    }

    // Encode animated preview as WebP and use it as the THUMBNAIL
    // The architecture strictly defines that video thumbnails are animated WebPs.
    // Using 320px for smaller file sizes (~40-80KB instead of 100-200KB at 480px)
    let thumbnail = if !preview_frames.is_empty() {
        Some(encode_animated_webp(&preview_frames, 320)?)
    } else {
        None
    };

    // Transcode video to H.265 MP4 (Original)
    let original = transcode_video_h265(app, path, output_path).await?;

    Ok(ProcessedMedia {
        original,
        original_extension: "mp4".to_string(),
        thumbnail,     // This contains the animated WebP
        preview: None, // Deprecated/Unused in favor of using thumbnail for everything
        width,
        height,
    })
}

/// Process an audio file: convert to Opus
pub async fn process_audio(
    app: &tauri::AppHandle,
    path: &Path,
    output_path: &Path,
) -> Result<ProcessedMedia> {
    let original = transcode_audio_opus(app, path, output_path).await?;

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
        // Optimization for small images: scale down to 50% to save space, but keep reasonable min size
        let new_w = (width as f32 * 0.5) as u32;
        let new_h = (height as f32 * 0.5) as u32;

        // Ensure not too small (keep at least 200px or original if smaller)
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

/// Resize a video frame to new dimensions
fn resize_frame(frame: &frame::Video, width: u32, height: u32) -> Result<frame::Video> {
    let mut scaler = ScalingContext::get(
        frame.format(),
        frame.width(),
        frame.height(),
        ffmpeg::format::Pixel::RGB24,
        width,
        height,
        ScalingFlags::LANCZOS,
    )?;

    let mut scaled = frame::Video::empty();
    scaler.run(frame, &mut scaled)?;
    Ok(scaled)
}

/// Encode multiple frames as animated WebP using webp-animation crate
fn encode_animated_webp(frames: &[frame::Video], max_width: u32) -> Result<Vec<u8>> {
    use webp_animation::prelude::*;

    if frames.is_empty() {
        return Err(anyhow::anyhow!("No frames to encode"));
    }

    // Get dimensions from first frame
    let first = &frames[0];
    let (width, height) = calculate_thumbnail_dimensions(first.width(), first.height(), max_width);

    // Create encoder with Lossy configuration for smaller file size
    let config = EncodingConfig {
        encoding_type: EncodingType::Lossy(LossyEncodingConfig::default()),
        quality: 50.0,
        ..Default::default()
    };
    let options = EncoderOptions {
        encoding_config: Some(config),
        ..Default::default()
    };
    let mut encoder = Encoder::new_with_options((width, height), options)
        .context("Failed to create WebP encoder")?;

    // Frame duration in milliseconds (~300ms per frame = ~3 second loop for 10 frames)
    let frame_duration_ms = 300;
    let mut timestamp_ms = 0i32;

    for frame in frames {
        // Resize frame to thumbnail dimensions
        let resized = resize_frame(frame, width, height)?;

        // Convert to RGBA (webp-animation expects RGBA)
        let rgba_frame = if resized.format() != ffmpeg::format::Pixel::RGBA {
            let mut scaler = ScalingContext::get(
                resized.format(),
                resized.width(),
                resized.height(),
                ffmpeg::format::Pixel::RGBA,
                width,
                height,
                ScalingFlags::BILINEAR,
            )?;
            let mut scaled = frame::Video::empty();
            scaler.run(&resized, &mut scaled)?;
            scaled
        } else {
            resized
        };

        // Extract RGBA data
        let data = rgba_frame.data(0);
        let stride = rgba_frame.stride(0);

        // Copy row by row to handle stride
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let row_start = (y as usize) * stride;
            let row_end = row_start + (width * 4) as usize;
            pixels.extend_from_slice(&data[row_start..row_end]);
        }

        // Add frame to animation
        encoder
            .add_frame(&pixels, timestamp_ms)
            .context("Failed to add frame to animation")?;

        timestamp_ms += frame_duration_ms;
    }

    // Finalize and get bytes
    let webp_data = encoder
        .finalize(timestamp_ms)
        .context("Failed to finalize WebP animation")?;

    Ok(webp_data.to_vec())
}

/// Transcode video to H.265 MP4 using FFmpeg CLI subprocess (Tauri Sidecar)
async fn transcode_video_h265(
    app: &tauri::AppHandle,
    input_path: &Path,
    output_path: &Path,
) -> Result<Vec<u8>> {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    // Sidecar command arguments
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

    println!("Executing Sidecar FFmpeg command with args: {:?}", args);

    // Execute sidecar command
    let output_result = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| anyhow::anyhow!("Failed to create sidecar command: {}", e))?
        .args(&args)
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to execute sidecar: {}", e))?;

    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        println!("FFmpeg Sidecar stderr: {}", stderr);
        return Err(anyhow::anyhow!("FFmpeg video transcode failed: {}", stderr));
    }

    // Read the output file
    std::fs::read(output_path).context("Failed to read transcoded video")
}

/// Transcode audio to Opus using FFmpeg CLI subprocess (Tauri Sidecar)
async fn transcode_audio_opus(
    app: &tauri::AppHandle,
    input_path: &Path,
    output_path: &Path,
) -> Result<Vec<u8>> {
    use tauri_plugin_shell::ShellExt;

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

    let output_result = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| anyhow::anyhow!("Failed to create sidecar command: {}", e))?
        .args(&args)
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to execute sidecar: {}", e))?;

    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        println!("FFmpeg Sidecar stderr: {}", stderr);
        return Err(anyhow::anyhow!("FFmpeg audio transcode failed: {}", stderr));
    }

    std::fs::read(output_path).context("Failed to read transcoded audio")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thumbnail_dimensions() {
        // Landscape image
        let (w, h) = calculate_thumbnail_dimensions(1920, 1080, 720);
        assert_eq!(w, 720);
        assert!(h <= 720);

        // Portrait image
        let (w, h) = calculate_thumbnail_dimensions(1080, 1920, 720);
        assert!(w <= 720);
        assert_eq!(h, 720);

        // Small image (no resize)
        let (w, h) = calculate_thumbnail_dimensions(400, 300, 720);
        assert_eq!(w, 400);
        assert_eq!(h, 300);
    }

    #[test]
    fn test_ffmpeg_init() {
        assert!(init().is_ok());
    }
}
