use serde::{Deserialize, Serialize};

/// Vault credentials and encryption key stored in local JSON.
/// Note: `name` and `visits` are stored in SQLite, not here.
#[derive(Deserialize, Serialize, Clone, Default)]
pub struct VaultConfig {
    #[serde(default)]
    pub id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub vault_key: String,
    // Legacy fields - kept for migration but ignored after first load
    #[serde(default, skip_serializing)]
    pub name: Option<String>,
    #[serde(default, skip_serializing)]
    pub visits: Option<u32>,
}

/// Public vault info for UI display.
/// `name` and `visits` come from SQLite, not the JSON config.
#[derive(Serialize, Deserialize, Clone)]
pub struct VaultPublic {
    pub id: String,
    pub name: String,
    pub bucket: String,
    pub visits: u32,
}

impl VaultConfig {
    pub fn new(
        id: String,
        access_key_id: String,
        secret_access_key: String,
        region: String,
        bucket: String,
        vault_key: String,
    ) -> Self {
        Self {
            id,
            access_key_id,
            secret_access_key,
            region,
            bucket,
            vault_key,
            name: None,
            visits: None,
        }
    }
}

pub mod store {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};

    fn get_vaults_path(app: &AppHandle) -> Result<PathBuf, String> {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        if !app_dir.exists() {
            fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        }
        Ok(app_dir.join("vaults.json"))
    }

    fn read_all(app: &AppHandle) -> Result<Vec<VaultConfig>, String> {
        let path = get_vaults_path(app)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    fn write_all(app: &AppHandle, vaults: &[VaultConfig]) -> Result<(), String> {
        let path = get_vaults_path(app)?;
        let content = serde_json::to_string_pretty(vaults).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn save_vault(app: &AppHandle, config: &VaultConfig) -> Result<(), String> {
        let mut vaults = read_all(app)?;

        // Update or add
        if let Some(idx) = vaults.iter().position(|v| v.id == config.id) {
            vaults[idx] = config.clone();
        } else {
            vaults.push(config.clone());
        }

        write_all(app, &vaults)
    }

    /// Get list of vault IDs and buckets (name/visits come from SQLite)
    pub fn get_vault_ids(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
        let vaults = read_all(app)?;
        Ok(vaults.into_iter().map(|v| (v.id, v.bucket)).collect())
    }

    pub fn load_vault(app: &AppHandle, id: &str) -> Result<VaultConfig, String> {
        let vaults = read_all(app)?;
        vaults
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| "Vault not found".to_string())
    }

    /// Delete a vault from the JSON registry
    pub fn delete_vault(app: &AppHandle, id: &str) -> Result<(), String> {
        let mut vaults = read_all(app)?;
        vaults.retain(|v| v.id != id);
        write_all(app, &vaults)
    }
}

#[derive(Deserialize)]
pub struct BootstrapConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
}
