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
    use chacha20poly1305::{
        aead::{generic_array::GenericArray, Aead, KeyInit},
        ChaCha20Poly1305, Nonce,
    };
    use rand::{rngs::OsRng, RngCore};
    use std::fs;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};
    // use argon2::{
    //     password_hash::{rand_core::OsRng as ArgonRng, SaltString},
    //     Argon2, PasswordHasher,
    // };

    // Internal secret for zero-config encryption.
    const INTERNAL_SECRET: &str = "boreal-internal-static-key-v1-do-not-share";

    fn get_vaults_path(app: &AppHandle) -> Result<PathBuf, String> {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        if !app_dir.exists() {
            fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        }
        Ok(app_dir.join("vaults.dat")) // Change extension to indicate binary/encrypted
    }

    fn get_legacy_path(app: &AppHandle) -> Result<PathBuf, String> {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(app_dir.join("vaults.json"))
    }

    pub fn migrate_if_needed(app: &AppHandle) -> Result<(), String> {
        let legacy = get_legacy_path(app)?;
        let new_path = get_vaults_path(app)?;

        if legacy.exists() && !new_path.exists() {
            println!("[Vault Migration] Found legacy vaults.json, migrating to Encrypted Store...");
            match fs::read_to_string(&legacy) {
                Ok(content) => {
                    let vaults: Vec<VaultConfig> =
                        serde_json::from_str(&content).unwrap_or_default();
                    if !vaults.is_empty() {
                        write_all(app, &vaults)?;
                        println!("[Vault Migration] Encrypted and saved. Rename legacy.");
                        fs::rename(&legacy, legacy.with_extension("json.bak")).ok();
                    }
                }
                Err(e) => eprintln!("[Vault Migration] Failed to read legacy: {}", e),
            }
        }
        Ok(())
    }

    fn derive_key(_salt: &[u8]) -> [u8; 32] {
        // Simple hashing for static internal key.
        // In a real scenario with user password, we would use Argon2 with salt.
        // For static internal key, a fast hash is acceptable as entropy is fixed.
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(INTERNAL_SECRET.as_bytes());
        // hasher.update(_salt); // Salt not used for static key derivation to avoid storage complexity for now?
        // Actually, let's just hash the secret.
        let result = hasher.finalize();
        result.into()
    }

    fn read_all(app: &AppHandle) -> Result<Vec<VaultConfig>, String> {
        let path = get_vaults_path(app)?;
        if !path.exists() {
            return Ok(Vec::new());
        }

        let data = fs::read(&path).map_err(|e| e.to_string())?;
        if data.is_empty() {
            return Ok(Vec::new());
        }

        // Format: [Nonce: 12 bytes] [Ciphertext: ...]
        if data.len() < 12 {
            // Might be corrupted or empty?
            return Ok(Vec::new());
        }

        let (nonce_bytes, ciphertext) = data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let key = derive_key(&[]);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&key));

        match cipher.decrypt(nonce, ciphertext) {
            Ok(plaintext) => {
                serde_json::from_slice(&plaintext).map_err(|e| format!("Invalid JSON: {}", e))
            }
            Err(_) => {
                Err("Failed to decrypt vault storage. Key mismatch or corruption.".to_string())
            }
        }
    }

    fn write_all(app: &AppHandle, vaults: &[VaultConfig]) -> Result<(), String> {
        let path = get_vaults_path(app)?;
        let json = serde_json::to_vec(vaults).map_err(|e| e.to_string())?;

        let key = derive_key(&[]);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&key));

        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, json.as_ref())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Save [Nonce] + [Ciphertext]
        let mut final_data = nonce_bytes.to_vec();
        final_data.extend(ciphertext);

        fs::write(&path, final_data).map_err(|e| e.to_string())
    }

    pub fn save_vault(app: &AppHandle, config: &VaultConfig) -> Result<(), String> {
        migrate_init(app);

        let mut vaults = read_all(app)?;
        if let Some(idx) = vaults.iter().position(|v| v.id == config.id) {
            vaults[idx] = config.clone();
        } else {
            vaults.push(config.clone());
        }
        write_all(app, &vaults)
    }

    pub fn get_vault_ids(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
        migrate_init(app);
        let vaults = read_all(app)?;
        Ok(vaults.into_iter().map(|v| (v.id, v.bucket)).collect())
    }

    pub fn load_vault(app: &AppHandle, id: &str) -> Result<VaultConfig, String> {
        migrate_init(app);
        let vaults = read_all(app)?;
        vaults
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| "Vault not found".to_string())
    }

    pub fn delete_vault(app: &AppHandle, id: &str) -> Result<(), String> {
        migrate_init(app);
        let mut vaults = read_all(app)?;
        vaults.retain(|v| v.id != id);
        write_all(app, &vaults)
    }

    fn migrate_init(app: &AppHandle) {
        let _ = migrate_if_needed(app);
    }
}

#[derive(Deserialize)]
pub struct BootstrapConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
}
