use anyhow::Result;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;

pub const NONCE_LEN: usize = 12;

pub fn derive_key(pin: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    // 100,000 iterations is a reasonable balance for this use case
    let _ = pbkdf2::<Hmac<Sha256>>(pin.as_bytes(), salt, 100_000, &mut key);
    key
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
