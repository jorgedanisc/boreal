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
                let p = media_processor::process_video(&transcoder, &path, &output, None).await;
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

        results.push(BenchmarkResult {
            file_name: file_name.clone(),
            media_type: media_type.to_string(),
            original_size_bytes: input_size,
            compressed_size_bytes: compressed_size,
            thumbnail_size_bytes: thumbnail_size,
            compression_ratio: compressed_size as f64 / input_size as f64,
            processing_time_ms: duration.as_millis(),
        });
    }

    Ok(results)
}

fn generate_report(results: &[BenchmarkResult]) -> String {
    let mut report = String::new();
    report.push_str("# Compression Benchmark & Cost Analysis Report\n\n");

    report.push_str("## Processing Metrics\n\n");
    report.push_str("| File | Type | Original | Compressed | Ratio | Thumb | Time |\n");
    report.push_str("|---|---|---|---|---|---|---|\n");

    let mut total_orig = 0;
    let mut total_comp = 0;
    let mut total_thumb = 0;

    for r in results {
        report.push_str(&format!(
            "| {} | {} | {} | {} | {:.2}% | {} | {}ms |\n",
            r.file_name,
            r.media_type,
            format_size(r.original_size_bytes),
            format_size(r.compressed_size_bytes),
            r.compression_ratio * 100.0,
            format_size(r.thumbnail_size_bytes),
            r.processing_time_ms
        ));
        total_orig += r.original_size_bytes;
        total_comp += r.compressed_size_bytes;
        total_thumb += r.thumbnail_size_bytes;
    }

    report.push_str("\n## Cost Projection (1 TB Library)\n\n");

    let avg_ratio = total_comp as f64 / total_orig as f64;
    let thumb_ratio = total_thumb as f64 / total_orig as f64;

    report.push_str(&format!(
        "Based on average compression ratio of **{:.2}%**:\n\n",
        avg_ratio * 100.0
    ));

    // Projection inputs
    let source_tb = 1.0;
    let compressed_gb = source_tb * 1024.0 * avg_ratio;
    let thumbs_gb = source_tb * 1024.0 * thumb_ratio;

    report.push_str("### Storage Requirements\n");
    report.push_str(&format!("- **Original Source**: 1 TB\n"));
    report.push_str(&format!(
        "- **Compressed Originals**: {:.2} GB\n",
        compressed_gb
    ));
    report.push_str(&format!("- **Thumbnails**: {:.2} GB\n\n", thumbs_gb));

    // Calculate Costs
    let da_cost = (compressed_gb * COST_GLACIER_DEEP) + (thumbs_gb * COST_S3_STANDARD);
    let ir_cost = (compressed_gb * COST_S3_INSTANT) + (thumbs_gb * COST_S3_STANDARD); // IR is costlier storage class

    // Wait, Instant Retrieval pricing:
    // S3 Standard-IA is roughly $0.0125, S3 One Zone-IA $0.01
    // Glacier Instant Retrieval is $0.004/GB ($4/TB) as per docs
    // Docs say: Start with cost from docs ($4.00/TB) which is accurate for IR class.

    report.push_str("### Monthly Cost Estimate\n\n");
    report.push_str("| Storage Strategy | Cost/Month (Est) | Notes |\n");
    report.push_str("|---|---|---|\n");
    report.push_str(&format!("| **Deep Archive** | **${:.2}** | Originals in Glacier DA ($0.99/TB), Thumbs in Standard |\n", da_cost));
    report.push_str(&format!("| **Instant Retrieval** | **${:.2}** | Originals in Glacier IR ($4.00/TB), Thumbs in Standard |\n", ir_cost));

    report.push_str("\n> Note: Instant Retrieval allows millisecond access to all photos, while Deep Archive requires 12-48h restore time.\n");

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
