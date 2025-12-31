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
