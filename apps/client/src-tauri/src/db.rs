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

    // Migration: Create metadata table for syncing vault properties (visits, name, etc.)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
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
