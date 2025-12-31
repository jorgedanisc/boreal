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
    /// Output extension (to verify format was preserved or changed)
    output_extension: String,
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
            "mp4" | "webm" | "mov" | "mkv" => {
                let output = test_dir.join(format!("output_{}.mp4", file_name));
                
                // Simulate Frontend Frame Extraction
                let frames = extract_simulation_frames(&path).ok();

                let p = media_processor::process_video(&transcoder, &path, &output, frames).await;
                fs::remove_file(output).ok();
                (p, "Video")
            }
            "ogg" | "mp3" | "wav" | "flac" => {
                let output = test_dir.join(format!("output_{}.opus", file_name));
                let p = media_processor::process_audio(&transcoder, &path, &output).await;
                fs::remove_file(output).ok();
                (p, "Audio")
            }
            "jpg" | "jpeg" | "png" | "webp" => (media_processor::process_image(&path), "Image"),
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

        results.push(BenchmarkResult {
            file_name: file_name.clone(),
            media_type: media_type.to_string(),
            original_size_bytes: input_size,
            compressed_size_bytes: compressed_size,
            thumbnail_size_bytes: thumbnail_size,
            compression_ratio: ratio,
            processing_time_ms: duration.as_millis(),
            status,
            output_extension: output_ext,
        });
    }

    Ok(results)
}

fn generate_report(results: &[BenchmarkResult]) -> String {
    let mut report = String::new();
    report.push_str("# Compression Benchmark & Cost Analysis Report\n\n");

    report.push_str("## Processing Metrics\n\n");
    report.push_str("| File | Type | Status | Original | Output | Ratio | Thumb | Time |\n");
    report.push_str("|---|---|---|---|---|---|---|---|\n");

    let mut total_orig = 0;
    let mut total_comp = 0;
    let mut total_thumb = 0;

    for r in results {
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
            r.processing_time_ms
        ));

        total_orig += r.original_size_bytes;
        total_comp += r.compressed_size_bytes;
        total_thumb += r.thumbnail_size_bytes;
    }

    report.push_str("\n## Cost Projection (1 TB Library)\n\n");

    // Separation for Mobile Analysis
    let mut total_av_orig = 0;
    let mut total_img_orig = 0;
    let mut total_img_comp = 0;

    for r in results {
        if r.media_type == "Video" || r.media_type == "Audio" {
            total_av_orig += r.original_size_bytes;
        } else {
            total_img_orig += r.original_size_bytes;
            total_img_comp += r.compressed_size_bytes;
        }
    }

    let img_ratio = if total_img_orig > 0 { total_img_comp as f64 / total_img_orig as f64 } else { 1.0 };
    let overall_ratio = total_comp as f64 / total_orig as f64;
    let thumb_ratio = total_thumb as f64 / total_orig as f64;

    report.push_str(&format!("Based on average compression ratio of **{:.2}%**:\n\n", overall_ratio * 100.0));

    // Desktop Scenario
    let source_tb = 1.0;
    let compressed_gb_desktop = source_tb * 1024.0 * overall_ratio;
    let thumbs_gb = source_tb * 1024.0 * thumb_ratio;
    
    // Mobile Scenario (AV not compressed)
    // Assume library distribution matches fixture distribution
    let av_fraction = total_av_orig as f64 / total_orig as f64;
    let img_fraction = total_img_orig as f64 / total_orig as f64;
    
    // Mobile Compressed Size = (1TB * img_fraction * img_ratio) + (1TB * av_fraction * 1.0)
    let compressed_gb_mobile = (source_tb * 1024.0 * img_fraction * img_ratio) + (source_tb * 1024.0 * av_fraction);

    report.push_str("### Storage Requirements (1 TB source)\n");
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

    report.push_str("\n> Note: Mobile clients upload Video/Audio originals uncompressed to save battery/heat and also due to architectural limitations, but still compress Images.\n");
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
    log::info!("Simulating frontend frame extraction for {:?}", path);
    // 1. Get Duration
    let output = std::process::Command::new("ffmpeg")
        .arg("-i")
        .arg(path)
        .output()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Parse Duration: 00:00:00.00
    let duration_line = stderr.lines().find(|l| l.trim().starts_with("Duration:")).unwrap_or("");
    let duration_str = duration_line.split(',').next().unwrap_or("").replace("Duration: ", "").trim().to_string();
    
    let parts: Vec<&str> = duration_str.split(':').collect();
    let mut duration_sec = 0.0;
    if parts.len() == 3 { // HH:MM:SS.mm
       let h: f64 = parts[0].parse().unwrap_or(0.0);
       let m: f64 = parts[1].parse().unwrap_or(0.0);
       let s: f64 = parts[2].parse().unwrap_or(0.0);
       duration_sec = h * 3600.0 + m * 60.0 + s;
    }

    if duration_sec <= 0.0 {
        // Fallback for very short or unparsable videos
        duration_sec = 1.0; 
    }

    // 2. Extract 6 frames
    let count = 6;
    let interval = duration_sec / count as f64;
    let mut frames = Vec::new();

    for i in 0..count {
        let timestamp = interval * i as f64;
        let output = std::process::Command::new("ffmpeg")
            .args(&[
                "-ss", &format!("{:.3}", timestamp),
                "-i", path.to_str().unwrap(),
                "-vframes", "1",
                "-f", "image2",
                "-c:v", "mjpeg", // Export as JPEG like frontend
                "-pipe:1"
            ])
            .output()?;
        
        if output.status.success() {
             frames.push(output.stdout);
        } else {
             log::warn!("Failed to extract frame at {}s", timestamp);
        }
    }

    Ok(frames)
}
