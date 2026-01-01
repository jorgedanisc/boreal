use anyhow::{Context, Result};
use boreal_lib::media_processor::{self, SystemTranscoder};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use std::time::Instant;

/// Constants from CostAnalysis.md (USD per GB)
const COST_S3_STANDARD: f64 = 0.023;
const COST_GLACIER_DEEP: f64 = 0.00099;
const COST_S3_INSTANT: f64 = 0.004;

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
    /// SSIM Quality score (0.0-1.0)
    ssim: Option<f64>,
    /// Whether the file size increased
    is_inflated: bool,
}

/// Calculate SSIM between original and compressed using FFmpeg
fn calculate_ssim(original: &Path, compressed: &[u8]) -> Option<f64> {
    let temp_name = format!("ssim_temp_{}.webp", uuid::Uuid::new_v4());
    let temp_path = std::env::temp_dir().join(temp_name);
    std::fs::write(&temp_path, compressed).ok()?;

    let output = std::process::Command::new("ffmpeg")
        .args(&[
            "-i", original.to_str()?,
            "-i", temp_path.to_str()?,
            "-lavfi", "ssim",
            "-f", "null", "-"
        ])
        .output()
        .ok()?;

    let _ = std::fs::remove_file(&temp_path);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Parse SSIM from stderr (format: "SSIM Y:... All:0.987654 (...")
    stderr.lines()
        .find(|l| l.contains("SSIM "))
        .and_then(|line| line.split("All:").nth(1))
        .and_then(|val| val.split_whitespace().next())
        .and_then(|v| v.parse().ok())
}

fn determine_status(ratio_percent: f64, input_ext: &str, output_ext: &str) -> (String, bool) {
    let ratio = ratio_percent / 100.0;
    
    // If input == output extension, assume passthrough logic was used if ratio ~ 100%
    if input_ext == output_ext {
        return ("Passthrough".to_string(), false);
    }
    
    if ratio > 1.05 {
        ("⚠️ Inflated".to_string(), true)
    } else if ratio > 0.95 {
        ("⏸️ Marginal".to_string(), false)
    } else {
        ("✅ Compressed".to_string(), false)
    }
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



        let input_size = fs::metadata(&path)?.len();
        let compressed_size = processed.original.len() as u64;
        let thumbnail_size = processed.thumbnail.map(|t| t.len() as u64).unwrap_or(0);
        let ratio = compressed_size as f64 / input_size as f64;
        
        let output_ext = processed.original_extension.clone();
        let input_ext = ext.clone();
        
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

        // Determine status and inflation
        let (status, is_inflated) = determine_status(ratio * 100.0, &input_ext, &output_ext);

        // Calculate SSIM for Real Images only (to save time, calculating SSIM is slow)
        let ssim = if media_type == "Image" && sample_category == "Real" {
            calculate_ssim(&path, &processed.original)
        } else {
            None
        };
        
        // Get bitrate for videos
        let input_bitrate = if media_type == "Video" {
            get_video_bitrate(&path)
        } else {
            None
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
            ssim,
            is_inflated,
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
    
    // Dataset summary
    report.push_str("## Dataset Summary\n\n");
    report.push_str("| Category | Files | Purpose |\n");
    report.push_str("|---|---|---|\n");
    report.push_str(&format!("| Synthetic | {} | Codec/format validation |\n", synthetic.len()));
    report.push_str(&format!("| Real | {} | **Realistic compression ratios** |\n", real.len()));
    report.push_str(&format!("| Edge | {} | Stress testing (long videos) |\n", edge.len()));
    report.push_str("\n");

    // === INFLATION ANALYSIS ===
    let inflated_files: Vec<_> = results.iter().filter(|r| r.is_inflated).collect();
    let inflated_bytes: u64 = inflated_files.iter().map(|r| r.compressed_size_bytes - r.original_size_bytes).sum();
    
    // Note: With Smart Passthrough active in app logic, we expect NO inflated files.
    // This section now serves as a regression test / bug detector.
    if !inflated_files.is_empty() {
        report.push_str("## ⚠️ REGRESSION: Inflation Detected\n\n");
        report.push_str("> **Smart Passthrough failed to prevent inflation for these files:**\n\n");
        report.push_str("| Metric | Value |\n");
        report.push_str("|---|---|\n");
        report.push_str(&format!("| Inflated Files | {} / {} |\n", inflated_files.len(), results.len()));
        report.push_str(&format!("| Extra Bytes Stored | {} |\n", format_size(inflated_bytes)));
        
        let inflated_jpg = inflated_files.iter().filter(|r| r.input_extension == "jpg" || r.input_extension == "jpeg").count();
        let inflated_png = inflated_files.iter().filter(|r| r.input_extension == "png").count();
        
        report.push_str("\n**Breakdown by Type**:\n");
        report.push_str(&format!("- JPEG: {} (Check media_processor logic)\n", inflated_jpg));
        report.push_str(&format!("- PNG: {} (Check media_processor logic)\n", inflated_png));
        report.push_str("\n");
        
        report.push_str("### Action Required\n");
        report.push_str("Debug `media_processor.rs` to ensure `should_passthrough` is correctly applied.\n\n");
    }

    // === REAL SAMPLE RESULTS (Main Data) ===
    report.push_str("## Real Sample Results (Actual Measured Performance)\n\n");
    report.push_str("| File | Type | Status | Original | Output | Ratio | SSIM | Time |\n");
    report.push_str("|---|---|---|---|---|---|---|---|\n");

    let mut real_orig = 0u64;
    let mut real_comp = 0u64;
    let mut real_thumb = 0u64;
    let mut real_video_orig = 0u64;
    let mut real_video_comp = 0u64;
    let mut real_audio_comp = 0u64;
    let mut real_img_comp = 0u64;
    
    for r in &real {
        let ssim_str = r.ssim.map(|s| format!("{:.4}", s)).unwrap_or_else(|| "-".to_string());
            
        let status_icon = if r.status == "Passthrough" { "↩️" } else { 
            if r.compression_ratio > 1.0 { "⚠️" } else { "✅" }
        };

        report.push_str(&format!(
            "| {} | {} | {} {} | {} | {} (.{}) | {:.2}% | {} | {}ms |\n",
            r.file_name,
            r.media_type,
            status_icon,
            r.status,
            format_size(r.original_size_bytes),
            format_size(r.compressed_size_bytes),
            r.output_extension,
            r.compression_ratio * 100.0,
            ssim_str,
            r.processing_time_ms,
        ));

        real_orig += r.original_size_bytes;
        real_comp += r.compressed_size_bytes;
        real_thumb += r.thumbnail_size_bytes;
        
        match r.media_type.as_str() {
            "Video" => {
                real_video_orig += r.original_size_bytes;
                real_video_comp += r.compressed_size_bytes;
            }
            "Audio" => {
                real_audio_comp += r.compressed_size_bytes;
            }
            _ => {
                real_img_comp += r.compressed_size_bytes;
            }
        }
    }

    // === SYNTHETIC TABLES ===
     if !synthetic.is_empty() {
        report.push_str("\n<details>\n<summary>Synthetic Results</summary>\n\n");
        report.push_str("| File | Status | Ratio | Time |\n|---|---|---|---|\n");
        for r in &synthetic {
            report.push_str(&format!("| {} | {} | {:.2}% | {}ms |\n", r.file_name, r.status, r.compression_ratio * 100.0, r.processing_time_ms));
        }
        report.push_str("</details>\n");
    }
    
    // === COST ANALYSIS ===
    if real_orig > 0 {
        // 1. DATASET VALIDATION
        let av_orig = real_video_orig + real_audio_comp;
        let av_fraction = av_orig as f64 / real_orig as f64;
        let img_fraction = 1.0 - av_fraction;
        let av_deviation = (av_fraction - 0.65_f64).abs();
        let img_deviation = (img_fraction - 0.33_f64).abs();
        
        report.push_str("\n## Dataset Composition Validation\n");
        report.push_str("| Metric | Value | Target | Status |\n");
        report.push_str("|---|---|---|---|\n");
        report.push_str(&format!("| Video/Audio | {:.1}% | ~65% | {} |\n", av_fraction * 100.0, if av_deviation <= 0.15 { "✅" } else { "⚠️" }));
        report.push_str(&format!("| Images | {:.1}% | ~33% | {} |\n", img_fraction * 100.0, if img_deviation <= 0.15 { "✅" } else { "⚠️" }));
        
        // 2. PROJECTED SCENARIOS
        report.push_str("\n## Cost Scenarios (1TB Library)\n");
        report.push_str("Projections based on **actual measured sizes** (Smart Passthrough Enabled).\n\n");
        report.push_str("> **Note:** Audio is always stored on S3 Standard (not archived).\n\n");
        
        let tb_bytes = 1024.0 * 1024.0 * 1024.0 * 1024.0;
        
        // Calculate fractions based on real samples
        let thumb_fraction = real_thumb as f64 / real_orig as f64;
        let audio_fraction = real_audio_comp as f64 / real_orig as f64;
        let video_img_comp = real_video_comp + real_img_comp;
        let video_img_fraction = video_img_comp as f64 / real_orig as f64;
        
        // Project to 1TB
        let thumbs_gb = (tb_bytes * thumb_fraction) / (1024.0 * 1024.0 * 1024.0);
        let audio_gb = (tb_bytes * audio_fraction) / (1024.0 * 1024.0 * 1024.0);
        let video_img_gb = (tb_bytes * video_img_fraction) / (1024.0 * 1024.0 * 1024.0);
        
        // Costs
        let cost_thumbs = thumbs_gb * COST_S3_STANDARD;
        let cost_audio = audio_gb * COST_S3_STANDARD;
        
        // Scenario A: DESKTOP (compress everything)
        let dt_da_cost = video_img_gb * COST_GLACIER_DEEP;
        let dt_ir_cost = video_img_gb * COST_S3_INSTANT;
        
        report.push_str("### 🖥️ Desktop (Compress Everything)\n");
        report.push_str("| Storage Class | Originals Cost/Mo | Audio Cost/Mo | Thumbnail Cost/Mo | **Total Cost/Mo** |\n");
        report.push_str("|---|---|---|---|---|\n");
        report.push_str(&format!("| Deep Archive | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | **${:.2}** |\n", 
            dt_da_cost, video_img_gb, cost_audio, audio_gb, cost_thumbs, thumbs_gb, dt_da_cost + cost_audio + cost_thumbs));
        report.push_str(&format!("| Instant Retrieval | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | **${:.2}** |\n", 
            dt_ir_cost, video_img_gb, cost_audio, audio_gb, cost_thumbs, thumbs_gb, dt_ir_cost + cost_audio + cost_thumbs));
        report.push_str("\n");

        // Scenario B: MOBILE (compress images only, videos stay original)
        let mobile_video_img = real_video_orig + real_img_comp;
        let mobile_video_img_fraction = mobile_video_img as f64 / real_orig as f64;
        let mobile_video_img_gb = (tb_bytes * mobile_video_img_fraction) / (1024.0 * 1024.0 * 1024.0);

        let mo_da_cost = mobile_video_img_gb * COST_GLACIER_DEEP;
        let mo_ir_cost = mobile_video_img_gb * COST_S3_INSTANT;

        report.push_str("### 📱 Mobile (Compress Images Only)\n");
        report.push_str("| Storage Class | Originals Cost/Mo | Audio Cost/Mo | Thumbnail Cost/Mo | **Total Cost/Mo** |\n");
        report.push_str("|---|---|---|---|---|\n");
        report.push_str(&format!("| Deep Archive | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | **${:.2}** |\n", 
            mo_da_cost, mobile_video_img_gb, cost_audio, audio_gb, cost_thumbs, thumbs_gb, mo_da_cost + cost_audio + cost_thumbs));
        report.push_str(&format!("| Instant Retrieval | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | ${:.2} ({:.2} GB) | **${:.2}** |\n", 
            mo_ir_cost, mobile_video_img_gb, cost_audio, audio_gb, cost_thumbs, thumbs_gb, mo_ir_cost + cost_audio + cost_thumbs));
    }
    
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
