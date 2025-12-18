use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
/// Maximum cache size in bytes (500MB default)
const MAX_CACHE_SIZE: u64 = 500 * 1024 * 1024;
/// Cache entry with metadata for LRU eviction
#[derive(Debug)]
struct CacheEntry {
    size: u64,
    last_access: std::time::SystemTime,
}
/// Local thumbnail cache using LRU eviction
pub struct ThumbnailCache {
    cache_dir: PathBuf,
    entries: RwLock<HashMap<String, CacheEntry>>,
    total_size: RwLock<u64>,
    max_size: u64,
}
impl ThumbnailCache {
    /// Create a new thumbnail cache for a vault
    pub fn new(vault_dir: &PathBuf) -> Result<Self> {
        let cache_dir = vault_dir.join("cache").join("thumbnails");
        if !cache_dir.exists() {
            fs::create_dir_all(&cache_dir).context("Failed to create cache directory")?;
        }
        let mut cache = Self {
            cache_dir,
            entries: RwLock::new(HashMap::new()),
            total_size: RwLock::new(0),
            max_size: MAX_CACHE_SIZE,
        };
        // Load existing cache entries
        cache.scan_existing()?;
        Ok(cache)
    }
    /// Scan existing cache files and populate the entries map
    fn scan_existing(&mut self) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        let mut total_size = 0u64;
        if let Ok(dir) = fs::read_dir(&self.cache_dir) {
            for entry in dir.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let size = metadata.len();
                        let last_access = metadata
                            .accessed()
                            .unwrap_or_else(|_| std::time::SystemTime::now());
                        if let Some(filename) = entry.file_name().to_str() {
                            entries.insert(filename.to_string(), CacheEntry { size, last_access });
                            total_size += size;
                        }
                    }
                }
            }
        }
        *self.total_size.write().unwrap() = total_size;
        Ok(())
    }
    /// Check if a thumbnail is cached
    pub fn contains(&self, id: &str) -> bool {
        let key = format!("{}.webp", id);
        self.entries.read().unwrap().contains_key(&key)
    }
    /// Get a cached thumbnail
    pub fn get(&self, id: &str) -> Option<Vec<u8>> {
        let key = format!("{}.webp", id);
        let path = self.cache_dir.join(&key);
        if !path.exists() {
            return None;
        }
        // Update last access time
        {
            let mut entries = self.entries.write().unwrap();
            if let Some(entry) = entries.get_mut(&key) {
                entry.last_access = std::time::SystemTime::now();
            }
        }
        // Read file
        fs::read(&path).ok()
    }
    /// Store a thumbnail in the cache
    pub fn put(&self, id: &str, data: &[u8]) -> Result<()> {
        let key = format!("{}.webp", id);
        let path = self.cache_dir.join(&key);
        let size = data.len() as u64;
        // Evict if necessary
        self.ensure_space(size)?;
        // Write file
        fs::write(&path, data).context("Failed to write cache file")?;
        // Update metadata
        {
            let mut entries = self.entries.write().unwrap();
            entries.insert(
                key,
                CacheEntry {
                    size,
                    last_access: std::time::SystemTime::now(),
                },
            );
        }
        *self.total_size.write().unwrap() += size;
        Ok(())
    }
    /// Ensure there's enough space for a new entry
    fn ensure_space(&self, needed: u64) -> Result<()> {
        let current = *self.total_size.read().unwrap();
        if current + needed <= self.max_size {
            return Ok(());
        }
        // Need to evict some entries
        let to_free = (current + needed).saturating_sub(self.max_size);
        // Get entries sorted by last access (oldest first)
        let mut sorted_entries: Vec<(String, CacheEntry)>;
        {
            let entries = self.entries.read().unwrap();
            sorted_entries = entries
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        CacheEntry {
                            size: v.size,
                            last_access: v.last_access,
                        },
                    )
                })
                .collect();
        }
        sorted_entries.sort_by(|a, b| a.1.last_access.cmp(&b.1.last_access));
        // Evict oldest entries until we have enough space
        let mut freed = 0u64;
        for (key, entry) in sorted_entries {
            if freed >= to_free {
                break;
            }
            let path = self.cache_dir.join(&key);
            if fs::remove_file(&path).is_ok() {
                freed += entry.size;
                self.entries.write().unwrap().remove(&key);
            }
        }
        let mut total = self.total_size.write().unwrap();
        *total = total.saturating_sub(freed);
        Ok(())
    }
    /// Clear all cached thumbnails
    #[allow(dead_code)]
    pub fn clear(&self) -> Result<()> {
        if let Ok(dir) = fs::read_dir(&self.cache_dir) {
            for entry in dir.flatten() {
                if entry.metadata().map(|m| m.is_file()).unwrap_or(false) {
                    fs::remove_file(entry.path()).ok();
                }
            }
        }
        self.entries.write().unwrap().clear();
        *self.total_size.write().unwrap() = 0;
        Ok(())
    }
    /// Get current cache size in bytes
    #[allow(dead_code)]
    pub fn size(&self) -> u64 {
        *self.total_size.read().unwrap()
    }
    /// Get number of cached items
    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.entries.read().unwrap().len()
    }
}
