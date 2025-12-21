//! EXIF metadata extraction module
//!
//! Extracts capture date and GPS coordinates from image files using the kamadak-exif crate.
//! Supports JPEG, TIFF, HEIF (HEIC/AVIF), PNG, and WebP formats.

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use exif::{In, Reader, Tag, Value};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Extracted EXIF metadata from an image
#[derive(Debug, Clone, Default)]
pub struct ExifMetadata {
    /// Original capture date/time (DateTimeOriginal > DateTimeDigitized > DateTime)
    pub captured_at: Option<DateTime<Utc>>,
    /// GPS latitude in decimal degrees (positive = North, negative = South)
    pub latitude: Option<f64>,
    /// GPS longitude in decimal degrees (positive = East, negative = West)
    pub longitude: Option<f64>,
}

impl ExifMetadata {
    /// Check if any useful metadata was extracted
    pub fn has_data(&self) -> bool {
        self.captured_at.is_some() || self.latitude.is_some() || self.longitude.is_some()
    }
}

/// Extract EXIF metadata from an image file
///
/// Returns ExifMetadata with extracted fields. Fields are None if not found or extraction fails.
/// This function never errors - it returns default metadata on any failure.
pub fn extract_metadata(path: &Path) -> ExifMetadata {
    match try_extract_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) => {
            log::info!(
                "[EXIF] Failed to extract metadata from {:?}: {}",
                path.file_name().unwrap_or_default(),
                e
            );
            ExifMetadata::default()
        }
    }
}

fn try_extract_metadata(path: &Path) -> Result<ExifMetadata> {
    let file = File::open(path).context("Failed to open file")?;
    let mut reader = BufReader::new(file);

    let exif = Reader::new()
        .read_from_container(&mut reader)
        .context("Failed to read EXIF data")?;

    let captured_at = extract_capture_date(&exif);
    let (latitude, longitude) = extract_gps_coordinates(&exif);

    Ok(ExifMetadata {
        captured_at,
        latitude,
        longitude,
    })
}

/// Extract capture date from EXIF data
/// Priority: DateTimeOriginal > DateTimeDigitized > DateTime
fn extract_capture_date(exif: &exif::Exif) -> Option<DateTime<Utc>> {
    // Try DateTimeOriginal first (when the photo was actually taken)
    if let Some(dt) = get_datetime_field(exif, Tag::DateTimeOriginal) {
        return Some(dt);
    }

    // Fall back to DateTimeDigitized (when it was digitized/scanned)
    if let Some(dt) = get_datetime_field(exif, Tag::DateTimeDigitized) {
        return Some(dt);
    }

    // Last resort: DateTime (file modification time in camera)
    get_datetime_field(exif, Tag::DateTime)
}

fn get_datetime_field(exif: &exif::Exif, tag: Tag) -> Option<DateTime<Utc>> {
    let field = exif.get_field(tag, In::PRIMARY)?;

    if let Value::Ascii(ref vec) = field.value {
        if let Some(ascii_bytes) = vec.first() {
            // EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
            let date_str = String::from_utf8_lossy(ascii_bytes);
            if let Ok(naive_dt) = NaiveDateTime::parse_from_str(&date_str, "%Y:%m:%d %H:%M:%S") {
                return Some(DateTime::from_naive_utc_and_offset(naive_dt, Utc));
            }
        }
    }

    None
}

/// Extract GPS coordinates from EXIF data
fn extract_gps_coordinates(exif: &exif::Exif) -> (Option<f64>, Option<f64>) {
    let lat = extract_gps_coordinate(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, 'S');
    let lon = extract_gps_coordinate(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, 'W');
    (lat, lon)
}

fn extract_gps_coordinate(
    exif: &exif::Exif,
    coord_tag: Tag,
    ref_tag: Tag,
    negative_ref: char,
) -> Option<f64> {
    let coord_field = exif.get_field(coord_tag, In::PRIMARY)?;

    // GPS coordinates are stored as 3 rationals: degrees, minutes, seconds
    if let Value::Rational(ref rationals) = coord_field.value {
        if rationals.len() >= 3 {
            let degrees = rationals[0].to_f64();
            let minutes = rationals[1].to_f64();
            let seconds = rationals[2].to_f64();

            let mut decimal = degrees + minutes / 60.0 + seconds / 3600.0;

            // Check reference to determine sign (N/S for lat, E/W for lon)
            if let Some(ref_field) = exif.get_field(ref_tag, In::PRIMARY) {
                if let Value::Ascii(ref vec) = ref_field.value {
                    if let Some(ascii_bytes) = vec.first() {
                        if !ascii_bytes.is_empty() && ascii_bytes[0] as char == negative_ref {
                            decimal = -decimal;
                        }
                    }
                }
            }

            return Some(decimal);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_nonexistent_file() {
        let metadata = extract_metadata(Path::new("/nonexistent/file.jpg"));
        assert!(!metadata.has_data());
    }

    #[test]
    fn test_extract_default_metadata() {
        let metadata = ExifMetadata::default();
        assert!(metadata.captured_at.is_none());
        assert!(metadata.latitude.is_none());
        assert!(metadata.longitude.is_none());
        assert!(!metadata.has_data());
    }
}
