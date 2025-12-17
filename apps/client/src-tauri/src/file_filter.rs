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

/// Detect media type from file path using mime_guess (extension-based) with infer fallback (magic bytes)
pub fn detect_media_type(path: &Path) -> Result<MediaType, FileFilterError> {
    // 1. Extension-based detection using mime_guess (up-to-date IANA MIME database)
    let guessed = mime_guess::from_path(path).first_or_octet_stream();

    match guessed.type_() {
        mime::IMAGE => return Ok(MediaType::Image),
        mime::AUDIO => return Ok(MediaType::Audio),
        mime::VIDEO => return Ok(MediaType::Video),
        _ => {}
    }

    // 2. Fallback to magic-byte detection using infer crate
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

/// Get all supported media file extensions (for file dialog filters)
/// Returns a struct with categorized extensions for use in native file dialogs
#[derive(Debug, Clone, serde::Serialize)]
pub struct MediaExtensions {
    pub images: Vec<String>,
    pub videos: Vec<String>,
    pub audio: Vec<String>,
}

pub fn get_supported_extensions() -> MediaExtensions {
    use std::collections::HashSet;

    let mut images = HashSet::new();
    let mut videos = HashSet::new();
    let mut audio = HashSet::new();

    // Iterate through all known MIME types in mime_guess
    // mime_guess doesn't expose iteration, so we use a comprehensive list of common extensions
    // and validate each one against mime_guess
    let common_extensions = [
        // Images
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif", "raw",
        "cr2", "nef", "arw", "dng", "orf", "rw2", "pef", "sr2", "svg", "ico", "jfif", "psd", "xcf",
        "jp2", "j2k", "jpf", "jpm", "mj2", // Videos
        "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "3gp", "mts", "m2ts", "ts",
        "mpeg", "mpg", "ogv", "vob", "qt", "asf", "rm", "rmvb", "divx", "f4v", // Audio
        "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "wma", "aiff", "aif", "alac", "ape",
        "mid", "midi", "wv", "oga", "spx", "amr", "au", "snd", "ra", "gsm", "dts", "ac3", "caf",
        "mka", "mp2", "mpa", "mp1",
    ];

    for ext in common_extensions {
        let filename = format!("test.{}", ext);
        let path = std::path::Path::new(&filename);
        let guessed = mime_guess::from_path(path).first_or_octet_stream();

        match guessed.type_() {
            mime::IMAGE => {
                images.insert(ext.to_string());
            }
            mime::VIDEO => {
                videos.insert(ext.to_string());
            }
            mime::AUDIO => {
                audio.insert(ext.to_string());
            }
            _ => {}
        }
    }

    // Convert to sorted vectors
    let mut images: Vec<_> = images.into_iter().collect();
    let mut videos: Vec<_> = videos.into_iter().collect();
    let mut audio: Vec<_> = audio.into_iter().collect();

    images.sort();
    videos.sort();
    audio.sort();

    MediaExtensions {
        images,
        videos,
        audio,
    }
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
            detect_media_type(Path::new("photo.webp")).unwrap(),
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
        assert_eq!(
            detect_media_type(Path::new("audio.ogg")).unwrap(),
            MediaType::Audio
        );
        assert_eq!(
            detect_media_type(Path::new("voice.m4a")).unwrap(),
            MediaType::Audio
        );
    }

    #[test]
    fn test_unsupported() {
        assert!(detect_media_type(Path::new("document.pdf")).is_err());
        assert!(detect_media_type(Path::new("data.txt")).is_err());
    }
}
