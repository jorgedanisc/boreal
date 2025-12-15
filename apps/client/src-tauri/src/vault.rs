use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct VaultConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
    pub vault_key: String, // Base64 encoded 32-byte key
}

impl VaultConfig {
    pub fn new(
        access_key_id: String,
        secret_access_key: String,
        region: String,
        bucket: String,
        vault_key: String,
    ) -> Self {
        Self {
            access_key_id,
            secret_access_key,
            region,
            bucket,
            vault_key,
        }
    }
}
