use std::path::Path;
use thiserror::Error;
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MediaType {
    Image,
    Video,
    Audio,
}
#[derive(Debug, Error)]
pub enum FileFilterError {
    #[error("Unsupported file type: {0}")]
    UnsupportedType(String),
    #[error("Failed to read file: {0}")]
    ReadError(String),
    #[error("Could not determine file type")]
    UnknownType,
}
/// Supported image extensions
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif", "raw",
    "cr2", "nef", "arw", "dng", "orf", "rw2", "pef", "sr2",
];
/// Supported video extensions
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "3gp", "mts", "m2ts", "ts",
];
/// Supported audio extensions
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "wma", "aiff", "alac",
];
/// Detect media type from file path using extension and MIME sniffing
pub fn detect_media_type(path: &Path) -> Result<MediaType, FileFilterError> {
    // First, try extension-based detection for speed
    if let Some(ext) = path.extension() {
        let ext_lower = ext.to_string_lossy().to_lowercase();
        if IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
            return Ok(MediaType::Image);
        }
        if VIDEO_EXTENSIONS.contains(&ext_lower.as_str()) {
            return Ok(MediaType::Video);
        }
        if AUDIO_EXTENSIONS.contains(&ext_lower.as_str()) {
            return Ok(MediaType::Audio);
        }
    }
    // Fallback to MIME sniffing for unknown extensions
    let kind = infer::get_from_path(path).map_err(|e| FileFilterError::ReadError(e.to_string()))?;
    match kind {
        Some(k) => {
            let mime = k.mime_type();
            if mime.starts_with("image/") {
                Ok(MediaType::Image)
            } else if mime.starts_with("video/") {
                Ok(MediaType::Video)
            } else if mime.starts_with("audio/") {
                Ok(MediaType::Audio)
            } else {
                Err(FileFilterError::UnsupportedType(mime.to_string()))
            }
        }
        None => Err(FileFilterError::UnknownType),
    }
}
/// Check if a file is a supported media type
pub fn is_supported_media(path: &Path) -> bool {
    detect_media_type(path).is_ok()
}
/// Get file size in bytes
pub fn get_file_size(path: &Path) -> Result<u64, FileFilterError> {
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| FileFilterError::ReadError(e.to_string()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_image_extensions() {
        assert_eq!(
            detect_media_type(Path::new("photo.jpg")).unwrap(),
            MediaType::Image
        );
        assert_eq!(
            detect_media_type(Path::new("photo.PNG")).unwrap(),
            MediaType::Image
        );
        assert_eq!(
            detect_media_type(Path::new("photo.HEIC")).unwrap(),
            MediaType::Image
        );
    }
    #[test]
    fn test_video_extensions() {
        assert_eq!(
            detect_media_type(Path::new("video.mp4")).unwrap(),
            MediaType::Video
        );
        assert_eq!(
            detect_media_type(Path::new("video.MOV")).unwrap(),
            MediaType::Video
        );
    }
    #[test]
    fn test_audio_extensions() {
        assert_eq!(
            detect_media_type(Path::new("music.mp3")).unwrap(),
            MediaType::Audio
        );
        assert_eq!(
            detect_media_type(Path::new("music.FLAC")).unwrap(),
            MediaType::Audio
        );
    }
    #[test]
    fn test_unsupported() {
        assert!(detect_media_type(Path::new("document.pdf")).is_err());
        assert!(detect_media_type(Path::new("data.txt")).is_err());
    }
}
