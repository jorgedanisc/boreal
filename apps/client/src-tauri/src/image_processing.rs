use anyhow::{Context, Result};
use image::EncodableLayout;
use image::ImageReader;
use imgref::Img;
use ravif::Encoder;
use std::path::Path;

pub fn generate_thumbnail(path: &str) -> Result<Vec<u8>> {
    let img = ImageReader::open(Path::new(path))?.decode()?;
    let rgb = img.to_rgb8();

    // Thumbnail max size 400x400
    let resized = image::imageops::resize(&rgb, 400, 400, image::imageops::FilterType::Lanczos3);

    let width = resized.width() as usize;
    let height = resized.height() as usize;

    // Cast u8 slice to RGB8 slice safely (since we know it is RGB8 from to_rgb8())
    let raw = resized.as_bytes();
    let rgb_slice: &[rgb::RGB8] =
        unsafe { std::slice::from_raw_parts(raw.as_ptr() as *const rgb::RGB8, raw.len() / 3) };

    let img_ref = Img::new(rgb_slice, width, height);

    let enc = Encoder::new()
        .with_quality(50.0)
        .with_speed(6)
        .encode_rgb(img_ref)
        .context("Failed to encode AVIF")?;

    Ok(enc.avif_file)
}
