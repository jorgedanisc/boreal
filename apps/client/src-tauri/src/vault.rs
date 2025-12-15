use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct VaultConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub vault_key: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultPublic {
    pub id: String,
    pub name: String,
    pub bucket: String,
}

impl VaultConfig {
    pub fn new(
        id: String,
        name: String,
        access_key_id: String,
        secret_access_key: String,
        region: String,
        bucket: String,
        vault_key: String,
    ) -> Self {
        Self {
            id,
            name,
            access_key_id,
            secret_access_key,
            region,
            bucket,
            vault_key,
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

    pub fn get_vaults(app: &AppHandle) -> Result<Vec<VaultPublic>, String> {
        let vaults = read_all(app)?;
        Ok(vaults
            .into_iter()
            .map(|v| VaultPublic {
                id: v.id,
                name: v.name,
                bucket: v.bucket,
            })
            .collect())
    }

    pub fn load_vault(app: &AppHandle, id: &str) -> Result<VaultConfig, String> {
        let vaults = read_all(app)?;
        vaults
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| "Vault not found".to_string())
    }
}

#[derive(Deserialize)]
pub struct BootstrapConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
}
