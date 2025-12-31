use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{Duration, SystemTime};

/// Maximum file size to cache locally (500MB)
/// Files larger than this will be fetched from S3 each time
pub const MAX_CACHEABLE_SIZE: u64 = 500 * 1024 * 1024;

/// Cache TTL for originals (30 days)
const CACHE_TTL_DAYS: u64 = 30;

/// Cache entry with metadata for TTL eviction
#[derive(Debug)]
struct CacheEntry {
    size: u64,
    cached_at: SystemTime,
    extension: String,
}

/// Local originals cache with 30-day expiry
/// Only caches files ≤500MB, larger files must be re-fetched from S3
pub struct OriginalsCache {
    cache_dir: PathBuf,
    entries: RwLock<HashMap<String, CacheEntry>>,
}

impl OriginalsCache {
    /// Create a new originals cache for a vault
    pub fn new(vault_dir: &PathBuf) -> Result<Self> {
        let cache_dir = vault_dir.join("cache").join("originals");
        if !cache_dir.exists() {
            fs::create_dir_all(&cache_dir).context("Failed to create originals cache directory")?;
        }

        let mut cache = Self {
            cache_dir,
            entries: RwLock::new(HashMap::new()),
        };
        // Load existing cache entries
        cache.scan_existing()?;
        Ok(cache)
    }

    /// Scan existing cache files and populate the entries map
    fn scan_existing(&mut self) -> Result<()> {
        let mut entries = self.entries.write().unwrap();

        if let Ok(dir) = fs::read_dir(&self.cache_dir) {
            for entry in dir.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let size = metadata.len();
                        let cached_at = metadata
                            .modified()
                            .unwrap_or_else(|_| SystemTime::now());

                        if let Some(filename) = entry.file_name().to_str() {
                            // Parse id and extension from filename (e.g., "abc123.webp")
                            if let Some((id, ext)) = filename.rsplit_once('.') {
                                // Only add if not expired
                                if !Self::is_expired(cached_at) {
                                    entries.insert(id.to_string(), CacheEntry { 
                                        size, 
                                        cached_at,
                                        extension: ext.to_string(),
                                    });
                                } else {
                                    // Clean up expired file
                                    fs::remove_file(entry.path()).ok();
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Check if a cached_at timestamp is older than 30 days
    fn is_expired(cached_at: SystemTime) -> bool {
        let ttl = Duration::from_secs(CACHE_TTL_DAYS * 24 * 60 * 60);
        match SystemTime::now().duration_since(cached_at) {
            Ok(age) => age > ttl,
            Err(_) => true, // Future timestamp is weird, treat as expired
        }
    }

    /// Check if an original is cached (and not expired)
    pub fn is_cached(&self, id: &str) -> bool {
        let entries = self.entries.read().unwrap();
        
        if let Some(entry) = entries.get(id) {
            !Self::is_expired(entry.cached_at)
        } else {
            false
        }
    }

    /// Get cached original file path (if exists and not expired)
    pub fn get_path(&self, id: &str) -> Option<PathBuf> {
        let entries = self.entries.read().unwrap();
        
        if let Some(entry) = entries.get(id) {
            if Self::is_expired(entry.cached_at) {
                // Expired - clean up
                drop(entries);
                self.remove(id).ok();
                return None;
            }
            
            let filename = format!("{}.{}", id, entry.extension);
            let path = self.cache_dir.join(&filename);
            
            if path.exists() {
                return Some(path);
            }
        }
        
        None
    }

    /// Get cached original as bytes
    pub fn get(&self, id: &str) -> Option<Vec<u8>> {
        self.get_path(id).and_then(|path| fs::read(path).ok())
    }

    /// Store an original in the cache with proper extension
    /// Returns Ok(true) if cached, Ok(false) if file too large to cache
    pub fn put(&self, id: &str, extension: &str, data: &[u8]) -> Result<bool> {
        let size = data.len() as u64;

        // Don't cache files larger than 500MB
        if size > MAX_CACHEABLE_SIZE {
            log::info!(
                "[OriginalsCache] File {} is too large to cache ({} MB > {} MB)",
                id,
                size / (1024 * 1024),
                MAX_CACHEABLE_SIZE / (1024 * 1024)
            );
            return Ok(false);
        }

        // Remove old cached version if exists (might have different extension)
        self.remove(id).ok();

        let filename = format!("{}.{}", id, extension);
        let path = self.cache_dir.join(&filename);

        // Write file
        fs::write(&path, data).context("Failed to write cache file")?;

        // Update metadata
        {
            let mut entries = self.entries.write().unwrap();
            entries.insert(
                id.to_string(),
                CacheEntry {
                    size,
                    cached_at: SystemTime::now(),
                    extension: extension.to_string(),
                },
            );
        }

        log::info!(
            "[OriginalsCache] Cached original {}.{} ({} MB)",
            id,
            extension,
            size / (1024 * 1024)
        );

        Ok(true)
    }

    /// Remove an original from the cache
    pub fn remove(&self, id: &str) -> Result<()> {
        let extension = {
            let entries = self.entries.read().unwrap();
            entries.get(id).map(|e| e.extension.clone())
        };

        if let Some(ext) = extension {
            let filename = format!("{}.{}", id, ext);
            let path = self.cache_dir.join(&filename);
            if path.exists() {
                fs::remove_file(&path).ok();
            }
        }

        {
            let mut entries = self.entries.write().unwrap();
            entries.remove(id);
        }

        Ok(())
    }

    /// Clean up all expired entries
    #[allow(dead_code)]
    pub fn cleanup_expired(&self) -> Result<u32> {
        let mut removed = 0u32;
        let mut to_remove = Vec::new();

        // Find expired entries
        {
            let entries = self.entries.read().unwrap();
            for (id, entry) in entries.iter() {
                if Self::is_expired(entry.cached_at) {
                    to_remove.push((id.clone(), entry.extension.clone()));
                }
            }
        }

        // Remove them
        for (id, ext) in &to_remove {
            let filename = format!("{}.{}", id, ext);
            let path = self.cache_dir.join(&filename);
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }

        // Update map
        {
            let mut entries = self.entries.write().unwrap();
            for (id, _) in to_remove {
                entries.remove(&id);
            }
        }

        Ok(removed)
    }

    /// Get current cache size in bytes
    #[allow(dead_code)]
    pub fn size(&self) -> u64 {
        let entries = self.entries.read().unwrap();
        entries.values().map(|e| e.size).sum()
    }

    /// Get number of cached items
    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.entries.read().unwrap().len()
    }
}
