use rusqlite::{Connection, Result};
use std::path::Path;

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

    Ok(conn)
}
