//! Metadata extraction module using nom-exif
//!
//! Supports extraction of EXIF and other metadata from Images (JPEG, HEIF, PNG, WebP)
//! and Videos (MOV, MP4, QuickTime).

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use nom_exif::{parse_exif, ExifIter}; 
use std::fs::File;
use std::path::Path;

/// Extracted Metadata
#[derive(Debug, Clone, Default)]
pub struct ExifMetadata {
    /// Original capture date/time
    pub captured_at: Option<DateTime<Utc>>,
    /// GPS latitude
    pub latitude: Option<f64>,
    /// GPS longitude
    pub longitude: Option<f64>,
    
    // -- Extended Metadata --
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens_model: Option<String>,
    pub iso: Option<u32>,
    pub f_number: Option<f32>,
    pub exposure_time: Option<String>,
    
    // Intrinsic dimensions (from metadata, might differ from actual file stream)
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl ExifMetadata {
    pub fn has_data(&self) -> bool {
        self.captured_at.is_some() 
        || self.latitude.is_some() 
        || self.longitude.is_some()
        || self.make.is_some()
        || self.model.is_some()
    }
}

/// Extract metadata from file
pub fn extract_metadata(path: &Path) -> ExifMetadata {
    match try_extract(path) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("[Metadata] Failed to extract from {:?}: {}", path.file_name().unwrap_or_default(), e);
            ExifMetadata::default()
        }
    }
}

fn try_extract(path: &Path) -> Result<ExifMetadata> {
    let mut meta = ExifMetadata::default();
    
    let file = File::open(path)?;
    
    // Use parse_exif(reader, length_hint)
    // We pass None for length hint as we are reading from file (impl Read + Seek)
    let iter: ExifIter = match parse_exif(file, None)? {
        Some(i) => i,
        None => return Ok(meta),
    };
    
    // Iterate over tags
    for entry in iter {
        // entry is ParsedExifEntry
        
        // Use tag_code() directly
        let tag_id = entry.tag_code();
        
        // Use take_value() to get validity
        // It returns Option<EntryValue> (not Result)
        let value_str = match entry.take_value() {
            Some(v) => v.to_string(),
            None => continue,
        };
        
        // Debug log all found tags to verify what nom-exif returns for MOVs
        log::debug!("[Exif] Tag 0x{:04x} = {}", tag_id, value_str);

        match tag_id {
             // -- DATE & TIME --
            0x9003 | 0x9004 | 0x9291 => {
                if meta.captured_at.is_none() {
                    meta.captured_at = parse_date_str(&value_str);
                }
            }
            
            // -- CAMERA INFO --
            0x010f => meta.make = Some(value_str.to_string()),
            0x0110 => meta.model = Some(value_str.to_string()),
            0xa434 => meta.lens_model = Some(value_str.to_string()),
            
            // -- SETTINGS --
            0x8827 => meta.iso = value_str.parse().ok(),
            0x829d => meta.f_number = value_str.parse().ok(),
            0x829a => meta.exposure_time = Some(value_str.to_string()),
            
            // -- DIMENSIONS --
            0xa002 => meta.width = value_str.parse().ok(),
            0xa003 => meta.height = value_str.parse().ok(),
            
            // -- GPS (Attempt) --
            // Note: nom-exif might flatten GPS tags or return them with these IDs (1-4)
            // Implementation pending verification of string format
            0x0001 => log::debug!("[Exif] GPSLatRef: {}", value_str),
            0x0002 => log::debug!("[Exif] GPSLat: {}", value_str),
            0x0003 => log::debug!("[Exif] GPSLonRef: {}", value_str),
            0x0004 => log::debug!("[Exif] GPSLon: {}", value_str),

            _ => {}
        }
    }
    
    Ok(meta)
}

fn parse_date_str(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim().trim_matches('"');
    
    if let Ok(naive) = NaiveDateTime::parse_from_str(s, "%Y:%m:%d %H:%M:%S") {
        return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    None
}
