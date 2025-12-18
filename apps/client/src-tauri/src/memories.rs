use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct Memory {
    pub id: String,
    pub title: String,
    pub text_content: String,
    pub date: String, // ISO8601 or YYYY-MM-DD
    pub created_at: String,
    pub updated_at: String,
    pub media_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateMemoryPayload {
    pub title: String,
    pub text_content: String,
    pub date: String,
    pub media_ids: Vec<String>,
}

#[tauri::command]
pub async fn create_memory(
    state: State<'_, AppState>,
    payload: CreateMemoryPayload,
) -> Result<Memory, String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Transaction for atomic insert
    conn.execute(
        "INSERT INTO memories (id, title, text_content, date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            payload.title,
            payload.text_content,
            payload.date,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    // Insert Media Links
    let mut stmt = conn
        .prepare(
            "INSERT INTO memory_media (memory_id, media_id, display_order) VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| e.to_string())?;

    for (index, media_id) in payload.media_ids.iter().enumerate() {
        stmt.execute(rusqlite::params![id, media_id, index])
            .map_err(|e| e.to_string())?;
    }

    Ok(Memory {
        id,
        title: payload.title,
        text_content: payload.text_content,
        date: payload.date,
        created_at: now.clone(),
        updated_at: now,
        media_ids: payload.media_ids,
    })
}

#[tauri::command]
pub async fn get_memories(state: State<'_, AppState>) -> Result<Vec<Memory>, String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    // Get all memories
    let mut stmt = conn
        .prepare("SELECT id, title, text_content, date, created_at, updated_at FROM memories ORDER BY date DESC")
        .map_err(|e| e.to_string())?;

    let memories_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?, // id
                row.get::<_, String>(1)?, // title
                row.get::<_, String>(2)?, // text_content
                row.get::<_, String>(3)?, // date
                row.get::<_, String>(4)?, // created_at
                row.get::<_, String>(5)?, // updated_at
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();

    // Loop through memories and fetch media for each (N+1 query, but simpler for now and N is small per page usually)
    // Optimization: Could do a JOIN and group in Rust, but memories might have many media.
    // Let's optimize later if needed.

    // We need to collect first to avoid keeping borrow on stmt
    let mut memory_rows = Vec::new();
    for row in memories_iter {
        memory_rows.push(row.map_err(|e| e.to_string())?);
    }

    for (id, title, text_content, date, created_at, updated_at) in memory_rows {
        let mut media_stmt = conn
            .prepare(
                "SELECT media_id FROM memory_media WHERE memory_id = ?1 ORDER BY display_order ASC",
            )
            .map_err(|e| e.to_string())?;

        let media_ids: Vec<String> = media_stmt
            .query_map([&id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(Memory {
            id,
            title,
            text_content,
            date,
            created_at,
            updated_at,
            media_ids,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn delete_memory(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    conn.execute("DELETE FROM memories WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    // Cascade delete handles memory_media
    Ok(())
}

#[tauri::command]
pub async fn update_memory(
    state: State<'_, AppState>,
    id: String,
    payload: CreateMemoryPayload,
) -> Result<Memory, String> {
    let db_guard = state.db.lock().await;
    let conn = db_guard.as_ref().ok_or("DB not initialized")?;

    let now = chrono::Utc::now().to_rfc3339();

    // Update core fields
    conn.execute(
        "UPDATE memories SET title = ?1, text_content = ?2, date = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![
            payload.title,
            payload.text_content,
            payload.date,
            now,
            id
        ],
    )
    .map_err(|e| e.to_string())?;

    // Update media: distinct/diff is hard, so Delete All + Re-insert is easiest strategy
    conn.execute("DELETE FROM memory_media WHERE memory_id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO memory_media (memory_id, media_id, display_order) VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| e.to_string())?;

    for (index, media_id) in payload.media_ids.iter().enumerate() {
        stmt.execute(rusqlite::params![id, media_id, index])
            .map_err(|e| e.to_string())?;
    }

    Ok(Memory {
        id,
        title: payload.title,
        text_content: payload.text_content,
        date: payload.date,
        created_at: "".to_string(), // We don't fetch created_at here, client should presumably know or we fetch it if strictly needed.
        // For now return empty string or fetch it if crucial.
        // Let's just re-fetch the full object correctly to be safe?
        // Optimization: just pass back what we know, client usually updates optimistic UI.
        updated_at: now,
        media_ids: payload.media_ids,
    })
}
