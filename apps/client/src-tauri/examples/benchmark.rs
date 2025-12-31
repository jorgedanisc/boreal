use anyhow::{Context, Result};
use boreal_lib::media_processor::{self, SystemTranscoder};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use std::time::Instant;

/// Constants from CostAnalysis.md (USD per GB)
const COST_S3_STANDARD: f64 = 0.023;
const COST_GLACIER_DEEP: f64 = 0.00099;
const COST_S3_INSTANT: f64 = 0.004; // Additive to Standard for IR tier? No, it's a class.
                                    // Checking CostAnalysis.md:
                                    // Instant Retrieval: $4.00/TB/month = $0.004/GB/month
                                    // Deep Archive: $0.99/TB/month = $0.00099/GB/month
                                    // Standard: $23.00/TB/month = $0.023/GB/month
                                    // Thumbnails (Standard): $0.023/GB/month

#[tokio::main]
async fn main() -> Result<()> {
    log::info!("Starting Compression Benchmark & Cost Analysis...");

    // 1. Get Fixtures Directory from Args or Default
    let args: Vec<String> = env::args().collect();
    let fixtures_dir = if args.len() > 1 {
        PathBuf::from(&args[1])
    } else {
        // Default for local run if script was run
        PathBuf::from("../../.ci-fixtures/out")
    };

    log::info!("Looking for test assets in: {:?}", fixtures_dir);
    if !fixtures_dir.exists() {
        return Err(anyhow::anyhow!(
            "Fixtures directory not found: {:?}. Please run .ci-fixtures/generate.sh first.",
            fixtures_dir
        ));
    }

    // 2. Run Benchmarks
    let results = run_benchmarks(&fixtures_dir).await?;

    // 3. Generate Report
    let report = generate_report(&results);

    // 4. Save Report
    let report_path = Path::new("compression_report.md");
    fs::write(report_path, report)?;
    log::info!("Report generated at: {:?}", report_path.canonicalize()?);

    Ok(())
}

struct BenchmarkResult {
    file_name: String,
    media_type: String,
    original_size_bytes: u64,
    compressed_size_bytes: u64,
    thumbnail_size_bytes: u64,
    compression_ratio: f64,
    processing_time_ms: u128,
    /// Status: "Compressed", "Passthrough", or "Skipped"
    status: String,
    /// Input file extension
    input_extension: String,
    /// Output extension (to verify format was preserved or changed)
    output_extension: String,
    /// Input bitrate in kbps (for video passthrough analysis)
    input_bitrate_kbps: Option<u32>,
    /// Sample category: "Synthetic", "Real", or "Edge"
    sample_category: String,
}

/// Extract bitrate from video file using ffprobe
fn get_video_bitrate(path: &Path) -> Option<u32> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=bit_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap()
        ])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().parse::<u32>().ok().map(|b| b / 1000) // Convert to kbps
}

/// Recursively find relevant files in the directory
async fn run_benchmarks(test_dir: &Path) -> Result<Vec<BenchmarkResult>> {
    let mut results = Vec::new();
    let transcoder = SystemTranscoder;

    let entries = fs::read_dir(test_dir).context(format!("Failed to read dir {:?}", test_dir))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // filter out hidden files
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        if file_name.starts_with(".") {
            continue;
        }

        log::info!("Processing {}...", file_name);

        // Determine type by extension
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        let start = Instant::now();
        let (processed, media_type) = match ext.as_str() {
            "mp4" | "webm" | "mov" | "mkv" | "heic" => {
                let output = test_dir.join(format!("output_{}.mp4", file_name));
                
                // Simulate Frontend Frame Extraction
                let frames = extract_simulation_frames(&path).ok();

                let p = media_processor::process_video(&transcoder, &path, &output, frames).await;
                fs::remove_file(output).ok();
                (p, "Video")
            }
            "ogg" | "mp3" | "wav" | "flac" | "m4a" | "aac" => {
                let output = test_dir.join(format!("output_{}.opus", file_name));
                let p = media_processor::process_audio(&transcoder, &path, &output).await;
                fs::remove_file(output).ok();
                (p, "Audio")
            }
            "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tiff" | "tif" | "gif" => {
                let p = media_processor::process_image(&transcoder, &path).await;
                (p, "Image")
            }
            _ => {
                log::info!("Skipping unsupported file: {}", file_name);
                continue;
            }
        };


        if let Err(e) = processed {
            log::info!("Failed to process {}: {}", file_name, e);
            continue;
        }
        let processed = processed.unwrap();

        let duration = start.elapsed();

        let _original_size = processed.original.len() as u64; // This might be wrong if 'original' is compressed bytes?
                                                              // Wait, ProcessedMedia.original is Vec<u8> of the *processed* file?
                                                              // No, let's check ProcessedMedia definition.
                                                              // pub struct ProcessedMedia { pub original: Vec<u8>, pub thumbnail: Option<Vec<u8>> }
                                                              // Yes, 'original' is the processed bytes.
                                                              // We want the size of the INPUT file for the ratio.

        let input_size = fs::metadata(&path)?.len();
        let compressed_size = processed.original.len() as u64;
        let thumbnail_size = processed.thumbnail.map(|t| t.len() as u64).unwrap_or(0);
        let ratio = compressed_size as f64 / input_size as f64;
        
        // Determine status based on extension and ratio
        let output_ext = processed.original_extension.clone();
        let input_ext = ext.clone();
        
        // Get bitrate for videos
        let input_bitrate = if media_type == "Video" {
            get_video_bitrate(&path)
        } else {
            None
        };
        
        let status = if media_type == "Image" {
            // Images always get compressed to WebP
            "Compressed".to_string()
        } else if input_ext == output_ext {
            // Same extension = passthrough
            "Passthrough".to_string()
        } else if ratio >= 1.0 {
            // Inflated but transcoded (shouldn't happen with new logic)
            "⚠ Inflated".to_string()
        } else {
            "Compressed".to_string()
        };
        
        // Categorize sample by filename prefix
        let sample_category = if file_name.starts_with("synth_") {
            "Synthetic".to_string()
        } else if file_name.starts_with("edge_") {
            "Edge".to_string()
        } else if file_name.starts_with("real_") {
            "Real".to_string()
        } else {
            "Unknown".to_string()
        };

        results.push(BenchmarkResult {
            file_name: file_name.clone(),
            media_type: media_type.to_string(),
            original_size_bytes: input_size,
            compressed_size_bytes: compressed_size,
            thumbnail_size_bytes: thumbnail_size,
            compression_ratio: ratio,
            processing_time_ms: duration.as_millis(),
            status,
            input_extension: input_ext,
            output_extension: output_ext,
            input_bitrate_kbps: input_bitrate,
            sample_category,
        });
    }

    Ok(results)
}

fn generate_report(results: &[BenchmarkResult]) -> String {
    let mut report = String::new();
    report.push_str("# Compression Benchmark & Cost Analysis Report\n\n");
    
    // Separate results by category
    let synthetic: Vec<_> = results.iter().filter(|r| r.sample_category == "Synthetic").collect();
    let real: Vec<_> = results.iter().filter(|r| r.sample_category == "Real").collect();
    let edge: Vec<_> = results.iter().filter(|r| r.sample_category == "Edge").collect();
    let unknown: Vec<_> = results.iter().filter(|r| r.sample_category == "Unknown").collect();
    
    // Dataset summary
    report.push_str("## Dataset Summary\n\n");
    report.push_str("| Category | Files | Purpose |\n");
    report.push_str("|---|---|---|\n");
    report.push_str(&format!("| Synthetic | {} | Codec/format validation |\n", synthetic.len()));
    report.push_str(&format!("| Real | {} | **Realistic compression ratios** |\n", real.len()));
    report.push_str(&format!("| Edge | {} | Stress testing (long videos) |\n", edge.len()));
    if !unknown.is_empty() {
        report.push_str(&format!("| ⚠️ Unknown | {} | Unrecognized prefix |\n", unknown.len()));
    }
    report.push_str("\n");

    // === SYNTHETIC TEST RESULTS ===
    if !synthetic.is_empty() {
        report.push_str("## Synthetic Test Results (Codec Validation)\n\n");
        report.push_str("<details>\n<summary>Click to expand synthetic file results</summary>\n\n");
        report.push_str("| File | Type | Status | Original | Output | Ratio | Thumb | Time |\n");
        report.push_str("|---|---|---|---|---|---|---|---|\n");
        
        for r in &synthetic {
            report.push_str(&format!(
                "| {} | {} | {} | {} | {} (.{}) | {:.2}% | {} | {}ms |\n",
                r.file_name,
                r.media_type,
                r.status,
                format_size(r.original_size_bytes),
                format_size(r.compressed_size_bytes),
                r.output_extension,
                r.compression_ratio * 100.0,
                format_size(r.thumbnail_size_bytes),
                r.processing_time_ms,
            ));
        }
        report.push_str("\n</details>\n\n");
    }

    // === REAL SAMPLE RESULTS (Main Data) ===
    report.push_str("## Real Sample Results (Cost Projection Basis)\n\n");
    report.push_str("| File | Type | Status | Original | Output | Ratio | Thumb | Time | Bitrate |\n");
    report.push_str("|---|---|---|---|---|---|---|---|---|\n");

    let mut real_orig = 0u64;
    let mut real_comp = 0u64;
    let mut real_thumb = 0u64;
    let mut real_av_orig = 0u64;
    let mut real_img_orig = 0u64;
    let mut real_img_comp = 0u64;

    for r in &real {
        let bitrate_str = r.input_bitrate_kbps
            .map(|b| format!("{}kbps", b))
            .unwrap_or_else(|| "-".to_string());
            
        report.push_str(&format!(
            "| {} | {} | {} | {} | {} (.{}) | {:.2}% | {} | {}ms | {} |\n",
            r.file_name,
            r.media_type,
            r.status,
            format_size(r.original_size_bytes),
            format_size(r.compressed_size_bytes),
            r.output_extension,
            r.compression_ratio * 100.0,
            format_size(r.thumbnail_size_bytes),
            r.processing_time_ms,
            bitrate_str
        ));

        real_orig += r.original_size_bytes;
        real_comp += r.compressed_size_bytes;
        real_thumb += r.thumbnail_size_bytes;
        
        if r.media_type == "Video" || r.media_type == "Audio" {
            real_av_orig += r.original_size_bytes;
        } else {
            real_img_orig += r.original_size_bytes;
            real_img_comp += r.compressed_size_bytes;
        }
    }

    // === EDGE CASE RESULTS ===
    if !edge.is_empty() {
        report.push_str("\n## Edge Case Results (Stress Testing)\n\n");
        report.push_str("| File | Type | Status | Original | Output | Ratio | Thumb | Time | Bitrate |\n");
        report.push_str("|---|---|---|---|---|---|---|---|---|\n");
        
        for r in &edge {
            let bitrate_str = r.input_bitrate_kbps
                .map(|b| format!("{}kbps", b))
                .unwrap_or_else(|| "-".to_string());
                
            report.push_str(&format!(
                "| {} | {} | {} | {} | {} (.{}) | {:.2}% | {} | {}ms | {} |\n",
                r.file_name,
                r.media_type,
                r.status,
                format_size(r.original_size_bytes),
                format_size(r.compressed_size_bytes),
                r.output_extension,
                r.compression_ratio * 100.0,
                format_size(r.thumbnail_size_bytes),
                r.processing_time_ms,
                bitrate_str
            ));
        }
    }

    // === COST PROJECTION (Based on REAL samples only) ===
    report.push_str("\n---\n\n## Cost Projection (1 TB Library)\n\n");
    
    if real.is_empty() {
        report.push_str("> ⚠️ **WARNING**: No real samples found! Cost projection will be inaccurate.\n");
        report.push_str("> Please run `.ci-fixtures/generate.sh` to download realistic test data.\n\n");
        return report;
    }

    let img_ratio = if real_img_orig > 0 { real_img_comp as f64 / real_img_orig as f64 } else { 1.0 };
    let overall_ratio = real_comp as f64 / real_orig as f64;
    let thumb_ratio = real_thumb as f64 / real_orig as f64;
    
    let av_fraction = real_av_orig as f64 / real_orig as f64;
    let img_fraction = real_img_orig as f64 / real_orig as f64;

    // Validate dataset realism (target: 65% AV, 33% Images by storage)
    let av_target = 0.65;
    let img_target = 0.33;
    let av_deviation = (av_fraction - av_target).abs();
    let img_deviation = (img_fraction - img_target).abs();
    
    if av_deviation > 0.15 || img_deviation > 0.15 {
        report.push_str("> ⚠️ **Dataset Composition Warning**: The test dataset may not accurately reflect typical photo libraries.\n");
        report.push_str(&format!("> Expected ~65% Video/Audio, ~33% Images. Got {:.1}% and {:.1}%.\n\n", av_fraction * 100.0, img_fraction * 100.0));
    }

    report.push_str(&format!("Based on **{}** real samples with average compression ratio of **{:.2}%**:\n\n", real.len(), overall_ratio * 100.0));

    // Desktop Scenario
    let source_tb = 1.0;
    let compressed_gb_desktop = source_tb * 1024.0 * overall_ratio;
    let thumbs_gb = source_tb * 1024.0 * thumb_ratio;
    
    // Mobile Scenario (AV not compressed)
    let compressed_gb_mobile = (source_tb * 1024.0 * img_fraction * img_ratio) + (source_tb * 1024.0 * av_fraction);

    report.push_str("### Dataset Composition (Real Samples)\n\n");
    report.push_str("| Metric | Value | Target | Status |\n");
    report.push_str("|---|---|---|---|\n");
    report.push_str(&format!("| Video/Audio | {:.1}% | ~65% | {} |\n", 
        av_fraction * 100.0, 
        if av_deviation <= 0.15 { "✅" } else { "⚠️" }
    ));
    report.push_str(&format!("| Images | {:.1}% | ~33% | {} |\n", 
        img_fraction * 100.0,
        if img_deviation <= 0.15 { "✅" } else { "⚠️" }
    ));
    report.push_str(&format!("| Image Compression | {:.1}% | 20-40% | {} |\n\n", 
        img_ratio * 100.0,
        if img_ratio >= 0.15 && img_ratio <= 0.50 { "✅" } else { "⚠️" }
    ));

    report.push_str("### Storage Requirements (1 TB source)\n\n");
    report.push_str("| Strategy | Compressed Size | Thumbnails | Total Stored |\n");
    report.push_str("|---|---|---|---|\n");
    report.push_str(&format!("| **Desktop (Full Compression)** | {:.2} GB | {:.2} GB | {:.2} GB |\n", compressed_gb_desktop, thumbs_gb, compressed_gb_desktop + thumbs_gb));
    report.push_str(&format!("| **Mobile (Image Only)** | {:.2} GB | {:.2} GB | {:.2} GB |\n\n", compressed_gb_mobile, thumbs_gb, compressed_gb_mobile + thumbs_gb));

    // Calculate Costs
    let da_cost_desktop = (compressed_gb_desktop * COST_GLACIER_DEEP) + (thumbs_gb * COST_S3_STANDARD);
    let ir_cost_desktop = (compressed_gb_desktop * COST_S3_INSTANT) + (thumbs_gb * COST_S3_STANDARD);
    
    let da_cost_mobile = (compressed_gb_mobile * COST_GLACIER_DEEP) + (thumbs_gb * COST_S3_STANDARD);
    let ir_cost_mobile = (compressed_gb_mobile * COST_S3_INSTANT) + (thumbs_gb * COST_S3_STANDARD);

    report.push_str("### Monthly Cost Estimate\n\n");
    report.push_str("| Storage Class | Desktop Cost | Mobile Cost | Notes |\n");
    report.push_str("|---|---|---|---|\n");
    report.push_str(&format!("| **Deep Archive** | **${:.2}** | **${:.2}** | Originals in DA ($0.99/TB), Thumbs in Std |\n", da_cost_desktop, da_cost_mobile));
    report.push_str(&format!("| **Instant Retrieval** | **${:.2}** | **${:.2}** | Originals in IR ($4.00/TB), Thumbs in Std |\n", ir_cost_desktop, ir_cost_mobile));

    report.push_str("\n> **Note**: Mobile clients upload Video/Audio originals uncompressed to save battery/heat, but still compress Images.\n");
    report.push_str("\n> **Methodology**: Cost projections are calculated from `real_*` prefixed samples only (not synthetic test files).\n");
    report
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;

    if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Simulation of Frontend Frame Extraction
/// Uses ffmpeg to extract 6 frames evenly spaced
fn extract_simulation_frames(path: &Path) -> Result<Vec<Vec<u8>>> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    log::info!("Simulating frontend frame extraction for {:?}", path);
    // 1. Get Duration
    let output = std::process::Command::new("ffmpeg")
        .arg("-i")
        .arg(path)
        .output()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Improved Duration Parsing
    let mut duration_sec = 0.0;
    for line in stderr.lines() {
        let line = line.trim();
        if line.starts_with("Duration:") {
            if let Some(time_str) = line.split(',').next().and_then(|s| s.strip_prefix("Duration: ")) {
                let parts: Vec<&str> = time_str.trim().split(':').collect();
                if parts.len() == 3 {
                    let h: f64 = parts[0].parse().unwrap_or(0.0);
                    let m: f64 = parts[1].parse().unwrap_or(0.0);
                    let s: f64 = parts[2].parse().unwrap_or(0.0);
                    duration_sec = h * 3600.0 + m * 60.0 + s;
                    break;
                }
            }
        }
    }

    if duration_sec <= 0.0 {
        log::warn!("Could not parse duration for {:?}, defaulting to 1.0s. Stderr sample: {:.100}...", path, stderr);
        duration_sec = 1.0; 
    }

    // 2. Extract frames (Matching Logic from MultipleFileUploader.tsx)
    // const count = Math.min(8, Math.max(2, Math.floor(duration / 2)));
    let count = (duration_sec / 2.0).floor() as usize;
    let count = count.max(2).min(8);

    // const startOffset = Math.min(0.5, duration * 0.05);
    let start_offset = 0.5f64.min(duration_sec * 0.05);
    // const endBuffer = 0.5;
    let end_buffer = 0.5;

    // const safeDuration = Math.max(0, duration - startOffset - endBuffer);
    let safe_duration = (duration_sec - start_offset - end_buffer).max(0.0);
    
    // const interval = count > 1 ? safeDuration / (count - 1) : 0;
    let interval = if count > 1 { safe_duration / (count as f64 - 1.0) } else { 0.0 };

    let mut frames = Vec::new();
    let temp_dir = env::temp_dir();

    log::info!("Extracting {} frames for {:?} (duration: {:.2}s)", count, file_name, duration_sec);

    for i in 0..count {
        // const seekTime = Math.min(startOffset + (i * interval), duration - 0.1);
        let timestamp = (start_offset + (i as f64 * interval)).min(duration_sec - 0.1).max(0.0);
        
        let temp_frame_path = temp_dir.join(format!("frame_{}_{}.jpg", file_name, i));
        
        let output = std::process::Command::new("ffmpeg")
            .args(&[
                "-ss", &format!("{:.3}", timestamp),
                "-i", path.to_str().unwrap(),
                "-vframes", "1",
                "-f", "image2",
                "-c:v", "mjpeg",
                "-q:v", "3", // q:v 3 is roughly jpeg quality 80 (frontend uses 0.8)
                "-y",
                temp_frame_path.to_str().unwrap()
            ])
            .output()?;
        
        if output.status.success() {
             if let Ok(bytes) = fs::read(&temp_frame_path) {
                 if !bytes.is_empty() {
                     frames.push(bytes);
                 }
             }
             let _ = fs::remove_file(&temp_frame_path);
        } else {
             let err_msg = String::from_utf8_lossy(&output.stderr);
             log::warn!("Failed to extract frame at {}s for {:?}: {}", timestamp, file_name, err_msg);
        }
    }

    if frames.is_empty() {
        log::warn!("No frames extracted for {:?}. Thumbnail will be empty.", path);
        return Err(anyhow::anyhow!("No frames extracted"));
    } else {
        log::info!("Extracted {} frames for {:?}", frames.len(), file_name);
    }

    Ok(frames)
}
