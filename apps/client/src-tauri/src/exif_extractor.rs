//! Metadata extraction module using nom-exif
//!
//! Supports extraction of EXIF and other metadata from Images (JPEG, HEIF, PNG, WebP)
//! and Videos (MOV, MP4, QuickTime).

use anyhow::Result;
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
    
    // Pass 1: Standard Tags
    // We open file for reading standard tags
    let file = File::open(path)?;
    
    if let Some(iter) = parse_exif(file, None)? {
        for entry in iter {
            let tag_id = entry.tag_code();
            let value_str = match entry.take_value() {
                Some(v) => v.to_string(),
                None => continue,
            };
            
            // log::debug!("[Exif] Tag 0x{:04x} = {}", tag_id, value_str);
    
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
                
                _ => {}
            }
        }
    }
    
    // Pass 2: Precise GPS via nom-exif built-in parsing (requires separate File handle)
    // This calls iter.parse_gps_info() which properly handles Rational comparisons and alignment
    if let Ok(file_gps) = File::open(path) {
        // We must re-parse to get a fresh iterator since the previous one was consumed
        match parse_exif(file_gps, None) {
             Ok(Some(iter_gps)) => {
                 match iter_gps.parse_gps_info() {
                     Ok(Some(gps_info)) => {
                         let iso_str = gps_info.format_iso6709();
                         log::debug!("[Exif] GPS ISO String: '{}'", iso_str);
                         
                         if let Some((lat, lon)) = parse_iso6709_str(&iso_str) {
                              meta.latitude = Some(lat);
                              meta.longitude = Some(lon);
                              log::info!("[Exif] Precise GPS: lat={:?}, lon={:?}", lat, lon);
                         } else {
                              log::warn!("[Exif] Failed to parse ISO string: '{}'", iso_str);
                         }
                     },
                     Ok(None) => log::debug!("[Exif] No GPS info found via parse_gps_info()"),
                     Err(e) => log::warn!("[Exif] parse_gps_info() failed: {}", e),
                 }
             },
             Ok(None) => log::debug!("[Exif] Second pass parse_exif returned None"),
             Err(e) => log::warn!("[Exif] Second pass parse_exif error: {}", e),
        }
    }
    
    Ok(meta)
}

/// Parse ISO 6709 string (e.g. "+48.8577+002.295/" or "+51.51326-000.11307+14.313/") to lat/lon
/// Format: ±DD.DDDD±DDD.DDDD[±AAA.AAA]/  (altitude is optional)
fn parse_iso6709_str(s: &str) -> Option<(f64, f64)> {
    let s = s.trim().trim_end_matches('/');
    if s.is_empty() { return None; }
    
    // Find split index for latitude (second sign) - skip first char
    let lat_end = s.chars().skip(1).position(|c| c == '+' || c == '-').map(|p| p + 1)?;
    
    let lat_str = &s[0..lat_end];
    let remainder = &s[lat_end..];
    
    // Remainder is longitude, possibly followed by altitude
    // Find if there's a third sign (altitude) - skip first char of remainder
    let lon_end = remainder.chars().skip(1).position(|c| c == '+' || c == '-').map(|p| p + 1);
    
    let lon_str = match lon_end {
        Some(end) => &remainder[0..end],  // Strip altitude
        None => remainder,                 // No altitude
    };
    
    let lat = lat_str.parse::<f64>().ok()?;
    let lon = lon_str.parse::<f64>().ok()?;
    
    Some((lat, lon))
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
