//! Manifest Sync Module
//!
//! Handles serialization, encryption, and synchronization of vault data to S3.
//! The manifest contains all metadata (photos, memories) that should be synced
//! across devices.

use crate::crypto;
use crate::db;
use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Current manifest version for migration compatibility
const MANIFEST_VERSION: u32 = 1;

/// S3 key for the encrypted manifest
pub const MANIFEST_S3_KEY: &str = "manifest.enc";

/// Represents a photo record for sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoRecord {
    pub id: String,
    pub filename: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: Option<String>,
    pub captured_at: Option<String>,
    pub size_bytes: Option<i64>,
    pub s3_key: String,
    pub thumbnail_key: Option<String>,
    pub tier: String,
    pub media_type: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// Represents a memory record for sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub title: String,
    pub text_content: Option<String>,
    pub date: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Represents a memory-media association for sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMediaRecord {
    pub memory_id: String,
    pub media_id: String,
    pub display_order: i32,
}

/// The complete manifest data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestData {
    pub version: u32,
    pub name: String,
    pub visits: u32,
    pub photos: Vec<PhotoRecord>,
    pub memories: Vec<MemoryRecord>,
    pub memory_media: Vec<MemoryMediaRecord>,
    pub updated_at: String,
}

/// Statistics from a merge operation
#[derive(Debug, Default)]
pub struct MergeStats {
    pub photos_added: u32,
    pub photos_updated: u32,
    pub memories_added: u32,
    pub memories_updated: u32,
}

impl ManifestData {
    /// Create a new empty manifest
    pub fn new(name: String) -> Self {
        Self {
            version: MANIFEST_VERSION,
            name,
            visits: 0,
            photos: Vec::new(),
            memories: Vec::new(),
            memory_media: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Export all vault data from SQLite to a ManifestData struct
pub fn export_manifest(conn: &Connection) -> Result<ManifestData> {
    // Get metadata
    let name = db::get_metadata(conn, "name")?.unwrap_or_else(|| "Untitled Vault".to_string());
    let visits: u32 = db::get_metadata(conn, "visits")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Export photos
    let photos = export_photos(conn)?;

    // Export memories
    let memories = export_memories(conn)?;

    // Export memory_media associations
    let memory_media = export_memory_media(conn)?;

    Ok(ManifestData {
        version: MANIFEST_VERSION,
        name,
        visits,
        photos,
        memories,
        memory_media,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn export_photos(conn: &Connection) -> Result<Vec<PhotoRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, filename, width, height, created_at, captured_at, size_bytes, 
                s3_key, thumbnail_key, tier, media_type, latitude, longitude 
         FROM photos",
    )?;

    let photos = stmt.query_map([], |row| {
        Ok(PhotoRecord {
            id: row.get(0)?,
            filename: row.get(1)?,
            width: row.get(2)?,
            height: row.get(3)?,
            created_at: row.get(4)?,
            captured_at: row.get(5)?,
            size_bytes: row.get(6)?,
            s3_key: row.get(7)?,
            thumbnail_key: row.get(8)?,
            tier: row.get(9)?,
            media_type: row
                .get::<_, Option<String>>(10)?
                .unwrap_or_else(|| "image".to_string()),
            latitude: row.get(11)?,
            longitude: row.get(12)?,
        })
    })?;

    photos
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to export photos")
}

fn export_memories(conn: &Connection) -> Result<Vec<MemoryRecord>> {
    let mut stmt =
        conn.prepare("SELECT id, title, text_content, date, created_at, updated_at FROM memories")?;

    let memories = stmt.query_map([], |row| {
        Ok(MemoryRecord {
            id: row.get(0)?,
            title: row.get(1)?,
            text_content: row.get(2)?,
            date: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    memories
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to export memories")
}

fn export_memory_media(conn: &Connection) -> Result<Vec<MemoryMediaRecord>> {
    let mut stmt = conn.prepare("SELECT memory_id, media_id, display_order FROM memory_media")?;

    let records = stmt.query_map([], |row| {
        Ok(MemoryMediaRecord {
            memory_id: row.get(0)?,
            media_id: row.get(1)?,
            display_order: row.get(2)?,
        })
    })?;

    records
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to export memory_media")
}

/// Import manifest data into SQLite, merging with existing data
/// Uses "newest updated_at wins" conflict resolution
pub fn import_manifest(conn: &Connection, data: ManifestData) -> Result<MergeStats> {
    let mut stats = MergeStats::default();

    // Update metadata (visits are cumulative across devices)
    let local_visits: u32 = db::get_metadata(conn, "visits")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let merged_visits = std::cmp::max(local_visits, data.visits);
    db::set_metadata(conn, "visits", &merged_visits.to_string())?;

    // Name: remote wins if local is empty
    let local_name = db::get_metadata(conn, "name")?;
    if local_name.is_none() || local_name.as_deref() == Some("") {
        db::set_metadata(conn, "name", &data.name)?;
    }

    // Merge photos
    for photo in data.photos {
        let result = merge_photo(conn, &photo)?;
        match result {
            MergeResult::Added => stats.photos_added += 1,
            MergeResult::Updated => stats.photos_updated += 1,
            MergeResult::Skipped => {}
        }
    }

    // Merge memories
    for memory in data.memories {
        let result = merge_memory(conn, &memory)?;
        match result {
            MergeResult::Added => stats.memories_added += 1,
            MergeResult::Updated => stats.memories_updated += 1,
            MergeResult::Skipped => {}
        }
    }

    // Merge memory_media (simple upsert)
    for mm in data.memory_media {
        conn.execute(
            "INSERT OR REPLACE INTO memory_media (memory_id, media_id, display_order) 
             VALUES (?1, ?2, ?3)",
            rusqlite::params![mm.memory_id, mm.media_id, mm.display_order],
        )?;
    }

    Ok(stats)
}

enum MergeResult {
    Added,
    Updated,
    Skipped,
}

fn merge_photo(conn: &Connection, photo: &PhotoRecord) -> Result<MergeResult> {
    // Check if photo exists locally
    let existing: Option<String> = conn
        .query_row(
            "SELECT created_at FROM photos WHERE id = ?1",
            [&photo.id],
            |row| row.get(0),
        )
        .ok();

    match existing {
        None => {
            // New photo - insert
            conn.execute(
                "INSERT INTO photos (id, filename, width, height, created_at, captured_at, 
                                    size_bytes, s3_key, thumbnail_key, tier, media_type, 
                                    latitude, longitude)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    photo.id,
                    photo.filename,
                    photo.width,
                    photo.height,
                    photo.created_at,
                    photo.captured_at,
                    photo.size_bytes,
                    photo.s3_key,
                    photo.thumbnail_key,
                    photo.tier,
                    photo.media_type,
                    photo.latitude,
                    photo.longitude,
                ],
            )?;
            Ok(MergeResult::Added)
        }
        Some(local_created) => {
            // Photo exists - compare timestamps (newest wins)
            let remote_created = photo.created_at.as_deref().unwrap_or("");
            if remote_created > local_created.as_str() {
                // Remote is newer - update
                conn.execute(
                    "UPDATE photos SET filename = ?2, width = ?3, height = ?4, 
                                       created_at = ?5, captured_at = ?6, size_bytes = ?7,
                                       s3_key = ?8, thumbnail_key = ?9, tier = ?10,
                                       media_type = ?11, latitude = ?12, longitude = ?13
                     WHERE id = ?1",
                    rusqlite::params![
                        photo.id,
                        photo.filename,
                        photo.width,
                        photo.height,
                        photo.created_at,
                        photo.captured_at,
                        photo.size_bytes,
                        photo.s3_key,
                        photo.thumbnail_key,
                        photo.tier,
                        photo.media_type,
                        photo.latitude,
                        photo.longitude,
                    ],
                )?;
                Ok(MergeResult::Updated)
            } else {
                // Local is newer or same - skip
                Ok(MergeResult::Skipped)
            }
        }
    }
}

fn merge_memory(conn: &Connection, memory: &MemoryRecord) -> Result<MergeResult> {
    // Check if memory exists locally
    let existing: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM memories WHERE id = ?1",
            [&memory.id],
            |row| row.get(0),
        )
        .ok();

    match existing {
        None => {
            // New memory - insert
            conn.execute(
                "INSERT INTO memories (id, title, text_content, date, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    memory.id,
                    memory.title,
                    memory.text_content,
                    memory.date,
                    memory.created_at,
                    memory.updated_at,
                ],
            )?;
            Ok(MergeResult::Added)
        }
        Some(local_updated) => {
            // Memory exists - compare timestamps (newest wins)
            if memory.updated_at > local_updated {
                // Remote is newer - update
                conn.execute(
                    "UPDATE memories SET title = ?2, text_content = ?3, date = ?4,
                                         created_at = ?5, updated_at = ?6
                     WHERE id = ?1",
                    rusqlite::params![
                        memory.id,
                        memory.title,
                        memory.text_content,
                        memory.date,
                        memory.created_at,
                        memory.updated_at,
                    ],
                )?;
                Ok(MergeResult::Updated)
            } else {
                // Local is newer or same - skip
                Ok(MergeResult::Skipped)
            }
        }
    }
}

/// Encrypt manifest data using the vault key
pub fn encrypt_manifest(data: &ManifestData, key: &[u8; 32]) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(data).context("Failed to serialize manifest")?;
    crypto::encrypt(&json, key).context("Failed to encrypt manifest")
}

/// Decrypt manifest data using the vault key
pub fn decrypt_manifest(encrypted: &[u8], key: &[u8; 32]) -> Result<ManifestData> {
    let decrypted = crypto::decrypt(encrypted, key).context("Failed to decrypt manifest")?;
    serde_json::from_slice(&decrypted).context("Failed to deserialize manifest")
}
