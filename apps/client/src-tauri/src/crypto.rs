use anyhow::Result;
use argon2::{password_hash::rand_core::OsRng, Argon2, Params};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::RngCore;

pub const NONCE_LEN: usize = 12;

/// Derives a 32-byte key from a PIN using Argon2id.
///
/// Parameters are tuned to make brute-forcing expensive (0.5s - 1s per attempt).
/// Memory: 64MB (64 * 1024), Iterations: 4, Parallelism: 4
pub fn derive_key(pin: &str, salt: &[u8]) -> Result<[u8; 32]> {
    // Argon2 params: m=64MB, t=4, p=4
    let params = Params::new(64 * 1024, 4, 4, Some(32)).map_err(|e| anyhow::anyhow!("{}", e))?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    // Use the provided salt directly (assumes it's high entropy)
    // We need to convert raw salt bytes to SaltString if possible, or just use hash_password_custom
    // Since we want a raw 32-byte generic array for ChaCha20, we can use `hash_password`
    // but `hash_password` returns a PHC string. We want raw bytes.

    // Actually, `argon2` crate provides `hash_password_into`.
    let mut output_key = [0u8; 32];
    argon2
        .hash_password_into(pin.as_bytes(), salt, &mut output_key)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    Ok(output_key)
}

pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn encrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let nonce = Nonce::from_slice(&nonce);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = nonce.to_vec();
    result.extend(ciphertext);
    Ok(result)
}

pub fn decrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    if data.len() < NONCE_LEN {
        anyhow::bail!("Data too short");
    }

    let (nonce, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))
}
