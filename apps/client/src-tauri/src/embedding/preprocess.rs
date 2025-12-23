// CLIP-style image preprocessing for nomic-embed-vision-v1.5
// Matches the preprocessor_config.json from the model

use image::{imageops::FilterType, DynamicImage, GenericImageView};
use ndarray::Array4;

// CLIP normalization constants from preprocessor_config.json
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
const TARGET_SIZE: u32 = 224;

/// Preprocess image for nomic-embed-vision-v1.5
/// Pipeline:
/// 1. Resize (shortest side to 224, preserving aspect ratio)
/// 2. Center crop to 224x224
/// 3. Rescale by 1/255
/// 4. Normalize with CLIP mean/std
/// 
/// Returns tensor of shape [1, 3, 224, 224] (batch, channels, height, width)
pub fn preprocess_image(img: &DynamicImage) -> Array4<f32> {
    // Step 1: Resize shortest side to 224 (preserving aspect ratio)
    let (w, h) = img.dimensions();
    let (new_w, new_h) = if w < h {
        (TARGET_SIZE, (TARGET_SIZE as f32 * h as f32 / w as f32) as u32)
    } else {
        ((TARGET_SIZE as f32 * w as f32 / h as f32) as u32, TARGET_SIZE)
    };
    
    // Use Lanczos3 for high-quality downscaling (resample=3 in config = BICUBIC which is similar)
    let resized = img.resize_exact(new_w, new_h, FilterType::Lanczos3);

    // Step 2: Center crop to 224x224
    let x = (new_w.saturating_sub(TARGET_SIZE)) / 2;
    let y = (new_h.saturating_sub(TARGET_SIZE)) / 2;
    let cropped = resized.crop_imm(x, y, TARGET_SIZE, TARGET_SIZE);

    // Convert to RGB8 (handles RGBA, grayscale, etc.)
    let rgb = cropped.to_rgb8();

    // Step 3 & 4: Create tensor [1, 3, 224, 224] with rescaling and normalization
    let mut tensor = Array4::<f32>::zeros((1, 3, TARGET_SIZE as usize, TARGET_SIZE as usize));

    for (px, py, pixel) in rgb.enumerate_pixels() {
        let [r, g, b] = pixel.0;
        for (c, &val) in [r, g, b].iter().enumerate() {
            // Rescale to [0, 1] and normalize with CLIP mean/std
            let normalized = (val as f32 / 255.0 - MEAN[c]) / STD[c];
            tensor[[0, c, py as usize, px as usize]] = normalized;
        }
    }

    tensor
}

/// Preprocess image from bytes (for thumbnails stored as WebP)
pub fn preprocess_image_bytes(bytes: &[u8]) -> Result<Array4<f32>, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode image: {}", e))?;
    Ok(preprocess_image(&img))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preprocess_output_shape() {
        // Create a simple test image
        let img = DynamicImage::new_rgb8(640, 480);
        let tensor = preprocess_image(&img);
        
        assert_eq!(tensor.shape(), &[1, 3, 224, 224]);
    }

    #[test]
    fn test_preprocess_normalization_range() {
        // Create an image with known pixel values
        let img = DynamicImage::new_rgb8(224, 224);
        let tensor = preprocess_image(&img);
        
        // Black image (0,0,0) after normalization should give ~-1.8 to -1.5 range
        // depending on the channel (due to different means)
        for val in tensor.iter() {
            // Values should be reasonable after normalization
            assert!(*val > -5.0 && *val < 5.0, "Value {} out of expected range", val);
        }
    }
}
