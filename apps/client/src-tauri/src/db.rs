use rusqlite::{Connection, Result};
use std::path::Path;
use chrono;

pub fn init_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            created_at TEXT,
            size_bytes INTEGER,
            s3_key TEXT NOT NULL,
            thumbnail_key TEXT,
            tier TEXT NOT NULL,
            media_type TEXT NOT NULL DEFAULT 'image'
        )",
        [],
    )?;

    // Migration: Add media_type column if it doesn't exist (for existing databases)
    conn.execute(
        "ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'",
        [],
    )
    .ok(); // Ignore error if column already exists

    // Migration: Add captured_at for actual photo capture date (from EXIF)
    conn.execute("ALTER TABLE photos ADD COLUMN captured_at TEXT", [])
        .ok();

    // Migration: Add GPS coordinates
    conn.execute("ALTER TABLE photos ADD COLUMN latitude REAL", [])
        .ok();
    conn.execute("ALTER TABLE photos ADD COLUMN longitude REAL", [])
        .ok();

    // Migration: Add thumbnail size for more accurate vault size tracking
    conn.execute("ALTER TABLE photos ADD COLUMN thumbnail_size_bytes INTEGER", [])
        .ok();

    // Migration: Extended Metadata (Make, Model, Lens, Shooting Settings)
    conn.execute("ALTER TABLE photos ADD COLUMN make TEXT", []).ok();
    conn.execute("ALTER TABLE photos ADD COLUMN model TEXT", []).ok();
    conn.execute("ALTER TABLE photos ADD COLUMN lens_model TEXT", []).ok();
    conn.execute("ALTER TABLE photos ADD COLUMN iso INTEGER", []).ok();
    conn.execute("ALTER TABLE photos ADD COLUMN f_number REAL", []).ok();
    conn.execute("ALTER TABLE photos ADD COLUMN exposure_time TEXT", []).ok();

    // Migration: Create metadata table for syncing vault properties (visits, name, etc.)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: Memories Feature
    conn.execute(
        "CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            text_content TEXT,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS memory_media (
            memory_id TEXT NOT NULL,
            media_id TEXT NOT NULL,
            display_order INTEGER NOT NULL,
            PRIMARY KEY (memory_id, media_id),
            FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
            -- Note: We don't enforce FK on media_id loosely because media might be deleted separately
            -- or we might want to keep the reference even if the file is gone (to show a placeholder)
        )",
        [],
    )?;

    // Migration: Embeddings table for semantic search
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings (
            photo_id TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            model_version TEXT NOT NULL DEFAULT 'nomic-embed-vision-v1.5',
            created_at TEXT NOT NULL,
            FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Migration: Original Restores table for tracking Deep Glacier restore requests
    conn.execute(
        "CREATE TABLE IF NOT EXISTS original_restores (
            photo_id TEXT PRIMARY KEY,
            requested_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'restoring',  -- 'restoring', 'ready', 'viewed'
            expires_at TEXT,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
        )",
        [],
    )?;

    Ok(conn)
}


pub fn set_metadata(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)",
        [key, value],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_metadata(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM metadata WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;

    if let Some(row) = rows.next()? {
        let value: String = row.get(0)?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

pub fn save_embedding(conn: &Connection, photo_id: &str, embedding: &[f32]) -> Result<()> {
    // Convert f32 vector to bytes (u8)
    let bytes: Vec<u8> = embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    let created_at = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO embeddings (photo_id, embedding, created_at) VALUES (?1, ?2, ?3)",
        (photo_id, bytes, created_at),
    )?;

    Ok(())
}

pub fn load_embeddings(conn: &Connection) -> Result<Vec<(String, Vec<f32>)>> {
    let mut stmt = conn.prepare("SELECT photo_id, embedding FROM embeddings")?;
    
    let rows = stmt.query_map([], |row| {
        let photo_id: String = row.get(0)?;
        let bytes: Vec<u8> = row.get(1)?;
        
        // Convert bytes back to f32
        let embedding: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|chunk| {
                let bytes: [u8; 4] = chunk.try_into().unwrap();
                f32::from_le_bytes(bytes)
            })
            .collect();
            
        Ok((photo_id, embedding))
    })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    
    Ok(results)
}

// ============ Original Restores Functions ============

#[derive(Debug, Clone, serde::Serialize)]
pub struct RestoreRequest {
    pub photo_id: String,
    pub requested_at: String,
    pub status: String, // "restoring", "ready", "viewed"
    pub expires_at: Option<String>,
    pub size_bytes: i64,
}

pub fn insert_restore_request(
    conn: &Connection,
    photo_id: &str,
    size_bytes: i64,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO original_restores (photo_id, requested_at, status, size_bytes)
         VALUES (?1, ?2, 'restoring', ?3)",
        rusqlite::params![photo_id, now, size_bytes],
    )?;
    Ok(())
}

pub fn get_restore_request(conn: &Connection, photo_id: &str) -> Result<Option<RestoreRequest>> {
    let mut stmt = conn.prepare(
        "SELECT photo_id, requested_at, status, expires_at, size_bytes FROM original_restores WHERE photo_id = ?1"
    )?;
    
    let mut rows = stmt.query([photo_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(RestoreRequest {
            photo_id: row.get(0)?,
            requested_at: row.get(1)?,
            status: row.get(2)?,
            expires_at: row.get(3)?,
            size_bytes: row.get(4)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn update_restore_status(
    conn: &Connection,
    photo_id: &str,
    status: &str,
    expires_at: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE original_restores SET status = ?2, expires_at = ?3 WHERE photo_id = ?1",
        rusqlite::params![photo_id, status, expires_at],
    )?;
    Ok(())
}

/// Get all pending restores (status = 'restoring' or 'ready')
pub fn get_pending_restores(conn: &Connection) -> Result<Vec<RestoreRequest>> {
    let mut stmt = conn.prepare(
        "SELECT r.photo_id, r.requested_at, r.status, r.expires_at, r.size_bytes 
         FROM original_restores r
         WHERE r.status IN ('restoring', 'ready')
         ORDER BY r.requested_at DESC"
    )?;
    
    let rows = stmt.query_map([], |row| {
        Ok(RestoreRequest {
            photo_id: row.get(0)?,
            requested_at: row.get(1)?,
            status: row.get(2)?,
            expires_at: row.get(3)?,
            size_bytes: row.get(4)?,
        })
    })?;
    
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn delete_restore_request(conn: &Connection, photo_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM original_restores WHERE photo_id = ?1",
        [photo_id],
    )?;
    Ok(())
}
