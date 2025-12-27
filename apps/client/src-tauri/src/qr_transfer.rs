//! QR Streaming Vault Transfer
//!
//! Implements secure vault transfer via two-way QR handshake + animated fountain-coded QR.
//! - New device shows "Request QR" containing ephemeral public key
//! - Old device scans it, encrypts vault, displays animated UR-encoded QR stream
//! - No network required, no typing required

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use x25519_dalek::{PublicKey, StaticSecret};

const PROTOCOL_VERSION: u8 = 1;
const SESSION_EXPIRY_SECS: u64 = 180; // 3 minutes
const MAX_FRAGMENT_SIZE: usize = 15;

// ========================
// Types
// ========================

/// Request QR payload (shown by receiver/new device)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRequest {
    pub v: u8,
    #[serde(rename = "type")]
    pub request_type: String,
    pub session_id: String,
    pub expires_at: u64,
    pub receiver_pub: String, // Base64 encoded X25519 public key
}

/// Export session info returned to sender
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSession {
    pub session_id: String,
    pub sas_code: String,
    pub total_frames: usize,
}

/// Import progress info returned to receiver
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub complete: bool,
    pub sas_code: Option<String>,
    pub frames_received: usize,
    pub estimated_percent: f64,
    pub expected_parts: Option<usize>,
    pub debug_log: Option<String>,
}

// ========================
// Internal Session State
// ========================

/// Session state for the receiver (new device)
pub struct ReceiverSession {
    pub session_id: String,
    pub expires_at: u64,
    secret: StaticSecret,
    pub public_key: PublicKey,
    decoder: ur::Decoder,
    shared_secret: Option<[u8; 32]>,
    sender_public: Option<PublicKey>,
    decrypted_vault: Option<String>,
    frames_received: usize,
    expected_parts: Option<usize>,
}

impl ReceiverSession {
    pub fn new() -> Self {
        let mut session_id_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut session_id_bytes);
        let session_id = hex::encode(&session_id_bytes);

        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + SESSION_EXPIRY_SECS;

        let mut secret_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret_bytes);
        let secret = StaticSecret::from(secret_bytes);
        let public_key = PublicKey::from(&secret);

        Self {
            session_id,
            expires_at,
            secret,
            public_key,
            decoder: ur::Decoder::default(),
            shared_secret: None,
            sender_public: None,
            decrypted_vault: None,
            frames_received: 0,
            expected_parts: None,
        }
    }



    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now > self.expires_at
    }

    pub fn to_request(&self) -> ImportRequest {
        ImportRequest {
            v: PROTOCOL_VERSION,
            request_type: "boreal-import-request".to_string(),
            session_id: self.session_id.clone(),
            expires_at: self.expires_at,
            receiver_pub: BASE64.encode(self.public_key.as_bytes()),
        }
    }

    /// Process an incoming UR frame from the animated QR
    pub fn receive_frame(&mut self, ur_string: &str) -> Result<ImportProgress> {
        let mut log = String::with_capacity(256);
        log.push_str(&format!("Processing: {:.20}...\n", ur_string));

        // Try to extract expected parts count from the UR string (format: ur:bytes/X-Y/...)
        if self.expected_parts.is_none() {
            if let Some(parts) = Self::extract_expected_parts(ur_string) {
                self.expected_parts = Some(parts);
                log.push_str(&format!("Header: {} parts detected\n", parts));
            }
        }

        // We try to receive. If it fails (e.g. duplicate or invalid), we just ignore it
        // and return current progress, to avoid crashing the scanner loop.
        match self.decoder.receive(ur_string) {
            Ok(_) => {
                self.frames_received += 1;
                log::debug!(
                    "Accepted. Total: {}, Complete: {}, MsgLen: {:?}\n",
                    self.frames_received,
                    self.decoder.complete(),
                    self.decoder.message().ok().flatten().map(|v| v.len())
                );
            }
            Err(e) => {
                // Log ALL errors for debugging to find why it gets stuck
                log.push_str(&format!("Rejected: {:?}\n", e));
            }
        }

        // If complete, try to compute shared secret immediately so we can show SAS
        if self.decoder.complete() && self.shared_secret.is_none() {
            log.push_str("Decoder complete. Computing secret...\n");
            match self.try_compute_shared_secret() {
                Ok(_) => log.push_str("Secret computed.\n"),
                Err(e) => log.push_str(&format!("Secret error: {:?}\n", e)),
            }
        }

        // Calculate estimated percent
        let estimated_percent = if self.decoder.complete() {
            100.0
        } else if let Some(expected) = self.expected_parts {
            // Use expected parts if known
            let percent = (self.frames_received as f64 / expected as f64) * 100.0;
            percent.min(99.0) // Cap at 99% until truly complete
        } else {
            // Fallback heuristic
            (self.frames_received as f64 / 20.0 * 100.0).min(95.0)
        };

        // Also print to stdout for redundancy
        log::debug!("[Receiver] {}", log.replace("\n", " | "));

        let progress = ImportProgress {
            complete: self.decoder.complete(),
            sas_code: self.shared_secret.as_ref().map(|_| self.compute_sas()),
            frames_received: self.frames_received,
            estimated_percent,
            expected_parts: self.expected_parts,
            debug_log: Some(log),
        };

        Ok(progress)
    }

    /// Extract expected parts count from UR string (format: ur:bytes/X-Y/...)
    fn extract_expected_parts(ur_string: &str) -> Option<usize> {
        // UR format: ur:bytes/1-20/... where 20 is the total parts
        let parts: Vec<&str> = ur_string.split('/').collect();
        if parts.len() >= 2 {
            let seq_part = parts[1]; // e.g., "1-20"
            if let Some(dash_pos) = seq_part.find('-') {
                if let Ok(total) = seq_part[dash_pos + 1..].parse::<usize>() {
                    return Some(total);
                }
            }
        }
        None
    }

    fn try_compute_shared_secret(&mut self) -> Result<()> {
        let message = self.decoder.message().map_err(|e| anyhow!("{:?}", e))?;
        let payload = message.as_ref().ok_or(anyhow!("No message"))?;

        if payload.len() < 32 + crate::crypto::NONCE_LEN {
            return Err(anyhow!("Payload too short"));
        }

        // Extract sender public key (first 32 bytes)
        let (sender_pub_bytes, _) = payload.split_at(32);
        let sender_pub_arr: [u8; 32] = sender_pub_bytes
            .try_into()
            .map_err(|_| anyhow!("Invalid key"))?;
        let sender_public = PublicKey::from(sender_pub_arr);

        self.sender_public = Some(sender_public);

        // Compute shared secret
        let shared = self.secret.diffie_hellman(&sender_public);
        self.shared_secret = Some(*shared.as_bytes());

        Ok(())
    }

    /// Called when decoder is complete to decrypt the vault
    pub fn complete_import(&mut self) -> Result<String> {
        if !self.decoder.complete() {
            return Err(anyhow!("Import not complete"));
        }

        // Ensure we have shared secret (should have been computed in receive_frame)
        if self.shared_secret.is_none() {
            self.try_compute_shared_secret()?;
        }

        // Get the decoded payload
        let message = self
            .decoder
            .message()
            .map_err(|e| anyhow!("Failed to get message: {:?}", e))?;
        let payload = message.as_ref().ok_or(anyhow!("No message data"))?;

        // Parse: sender_pub (32) + nonce (12) + ciphertext
        let (_sender_pub, rest) = payload.split_at(32);

        let shared = self.shared_secret.ok_or(anyhow!("No shared secret"))?;

        // Derive session key using HKDF
        let session_key = self.derive_session_key(&shared)?;

        // Decrypt the vault
        let decrypted = crate::crypto::decrypt(rest, &session_key)?;
        let vault_json =
            String::from_utf8(decrypted).map_err(|e| anyhow!("Invalid UTF-8: {}", e))?;

        self.decrypted_vault = Some(vault_json.clone());
        Ok(vault_json)
    }

    fn derive_session_key(&self, shared: &[u8; 32]) -> Result<[u8; 32]> {
        let sender_pub = self
            .sender_public
            .as_ref()
            .ok_or(anyhow!("No sender public key"))?;

        // Derive session key with HKDF
        let mut info = Vec::new();
        info.extend_from_slice(b"boreal-qr-transfer-v1");
        info.extend_from_slice(self.session_id.as_bytes());
        info.extend_from_slice(sender_pub.as_bytes());
        info.extend_from_slice(self.public_key.as_bytes());

        let hk = Hkdf::<Sha256>::new(None, shared);
        let mut session_key = [0u8; 32];
        hk.expand(&info, &mut session_key)
            .map_err(|_| anyhow!("HKDF expand failed"))?;

        Ok(session_key)
    }

    fn compute_sas(&self) -> String {
        use sha2::{Digest, Sha256};

        let sender_pub = match &self.sender_public {
            Some(p) => p.as_bytes().to_vec(),
            None => return "------".to_string(),
        };

        let mut hasher = Sha256::new();
        hasher.update(b"boreal-sas-v1");
        hasher.update(self.session_id.as_bytes());
        hasher.update(&sender_pub);
        hasher.update(self.public_key.as_bytes());
        let result = hasher.finalize();

        // Take first 4 bytes as u32, mod 1_000_000 for 6 digits
        let num = u32::from_be_bytes([result[0], result[1], result[2], result[3]]) % 1_000_000;
        format!("{:06}", num)
    }
}

/// Session state for the sender (old device)
/// Pre-computes all QR frames at creation to avoid lifetime issues and memory leaks.
pub struct SenderSession {
    #[allow(dead_code)]
    pub session_id: String,
    #[allow(dead_code)]
    receiver_public: PublicKey,
    #[allow(dead_code)]
    public_key: PublicKey,
    #[allow(dead_code)]
    shared_secret: [u8; 32],
    #[allow(dead_code)]
    session_key: [u8; 32],
    /// Pre-computed UR frames for the animated QR
    frames: Vec<String>,
    /// Current frame index (cycles through frames)
    current_frame_idx: usize,
    pub sas_code: String,
}

impl SenderSession {
    pub fn from_request(request: &ImportRequest, vault_json: &str) -> Result<Self> {
        // Validate request
        if request.v != PROTOCOL_VERSION {
            return Err(anyhow!("Unsupported protocol version: {}", request.v));
        }

        if request.request_type != "boreal-import-request" {
            return Err(anyhow!("Invalid request type"));
        }

        // Check expiration
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
        if now > request.expires_at {
            return Err(anyhow!("Import request has expired"));
        }

        // Decode receiver's public key
        let receiver_pub_bytes = BASE64
            .decode(&request.receiver_pub)
            .map_err(|e| anyhow!("Invalid receiver public key: {}", e))?;
        let receiver_pub_arr: [u8; 32] = receiver_pub_bytes
            .try_into()
            .map_err(|_| anyhow!("Invalid public key length"))?;
        let receiver_public = PublicKey::from(receiver_pub_arr);

        // Generate our ephemeral keypair
        let mut secret_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret_bytes);
        let secret = StaticSecret::from(secret_bytes);
        let public_key = PublicKey::from(&secret);

        // Compute shared secret
        let shared = secret.diffie_hellman(&receiver_public);
        let shared_secret: [u8; 32] = *shared.as_bytes();

        // Derive session key with HKDF
        let mut info = Vec::new();
        info.extend_from_slice(b"boreal-qr-transfer-v1");
        info.extend_from_slice(request.session_id.as_bytes());
        info.extend_from_slice(public_key.as_bytes());
        info.extend_from_slice(receiver_public.as_bytes());

        let hk = Hkdf::<Sha256>::new(None, &shared_secret);
        let mut session_key = [0u8; 32];
        hk.expand(&info, &mut session_key)
            .map_err(|_| anyhow!("HKDF expand failed"))?;

        // Encrypt the vault
        let encrypted = crate::crypto::encrypt(vault_json.as_bytes(), &session_key)?;

        // Build payload: sender_pub (32) + encrypted (nonce + ciphertext)
        let mut payload = Vec::with_capacity(32 + encrypted.len());
        payload.extend_from_slice(public_key.as_bytes());
        payload.extend(encrypted);

        // Pre-compute all frames to avoid lifetime issues with the encoder
        // This eliminates the memory leak from Box::leak
        let frames = Self::precompute_frames(&payload)?;

        log::debug!(
            "[Sender] Payload: {} bytes, Fragment size: {}, Generated {} frames",
            payload.len(),
            MAX_FRAGMENT_SIZE,
            frames.len()
        );

        // Compute SAS code
        let sas_code = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(b"boreal-sas-v1");
            hasher.update(request.session_id.as_bytes());
            hasher.update(public_key.as_bytes());
            hasher.update(receiver_public.as_bytes());
            let result = hasher.finalize();
            let num = u32::from_be_bytes([result[0], result[1], result[2], result[3]]) % 1_000_000;
            format!("{:06}", num)
        };

        Ok(Self {
            session_id: request.session_id.clone(),
            receiver_public,
            public_key,
            shared_secret,
            session_key,
            frames,
            current_frame_idx: 0,
            sas_code,
        })
    }

    /// Pre-compute all fountain-encoded frames
    /// We generate 2x the minimum required frames to ensure redundancy for fountain decoding
    fn precompute_frames(payload: &[u8]) -> Result<Vec<String>> {
        let mut encoder = ur::Encoder::new(payload, MAX_FRAGMENT_SIZE, "bytes")
            .map_err(|e| anyhow!("UR encoder init error: {:?}", e))?;

        // Calculate how many core frames we need, then add redundancy
        let min_frames = (payload.len() + MAX_FRAGMENT_SIZE - 1) / MAX_FRAGMENT_SIZE;
        // Generate 3x frames for fountain code redundancy (handles missed scans)
        let target_frames = (min_frames * 3).max(30);

        let mut frames = Vec::with_capacity(target_frames);
        for _ in 0..target_frames {
            let part = encoder
                .next_part()
                .map_err(|e| anyhow!("UR encode error: {:?}", e))?;
            frames.push(part);
        }

        log::debug!(
            "[Sender] Pre-computed {} frames (min required: {})",
            frames.len(),
            min_frames
        );

        Ok(frames)
    }

    /// Get the next UR-encoded frame for the animated QR
    /// Cycles through pre-computed frames continuously
    pub fn next_frame(&mut self) -> Result<String> {
        if self.frames.is_empty() {
            return Err(anyhow!("No frames available"));
        }

        let frame = self.frames[self.current_frame_idx].clone();
        self.current_frame_idx = (self.current_frame_idx + 1) % self.frames.len();

        // Log every 10th frame to avoid spam
        if self.current_frame_idx % 10 == 0 {
            log::debug!(
                "[Sender] Serving frame {}/{}",
                self.current_frame_idx,
                self.frames.len()
            );
        }

        Ok(frame)
    }

    pub fn total_frames(&self) -> usize {
        self.frames.len()
    }
}

// ========================
// Transfer Manager
// ========================

pub struct QrTransferManager {
    receiver_session: Arc<Mutex<Option<ReceiverSession>>>,
    sender_session: Arc<Mutex<Option<SenderSession>>>,
}

impl QrTransferManager {
    pub fn new() -> Self {
        Self {
            receiver_session: Arc::new(Mutex::new(None)),
            sender_session: Arc::new(Mutex::new(None)),
        }
    }

    // === Receiver (New Device) Functions ===

    /// Create a new import request (generates Request QR data)
    pub async fn create_import_request(&self) -> Result<ImportRequest> {
        let session = ReceiverSession::new();
        let request = session.to_request();
        *self.receiver_session.lock().await = Some(session);
        Ok(request)
    }

    /// Submit a scanned UR frame
    pub async fn submit_import_frame(&self, ur_string: &str) -> Result<ImportProgress> {
        let mut session_guard = self.receiver_session.lock().await;
        let session = session_guard
            .as_mut()
            .ok_or(anyhow!("No active import session"))?;

        if session.is_expired() {
            return Err(anyhow!("Import session expired"));
        }

        session.receive_frame(ur_string)
    }

    /// Complete the import after all frames received
    pub async fn complete_import(&self) -> Result<String> {
        let mut session_guard = self.receiver_session.lock().await;
        let session = session_guard
            .as_mut()
            .ok_or(anyhow!("No active import session"))?;
        session.complete_import()
    }

    /// Get current import progress
    pub async fn get_import_progress(&self) -> Result<ImportProgress> {
        let session_guard = self.receiver_session.lock().await;
        let session = session_guard
            .as_ref()
            .ok_or(anyhow!("No active import session"))?;

        // Calculate estimated percent
        let estimated_percent = if session.decoder.complete() {
            100.0
        } else if let Some(expected) = session.expected_parts {
            let percent = (session.frames_received as f64 / expected as f64) * 100.0;
            percent.min(99.0)
        } else {
            (session.frames_received as f64 / 20.0 * 100.0).min(95.0)
        };

        Ok(ImportProgress {
            complete: session.decoder.complete(),
            sas_code: session
                .shared_secret
                .as_ref()
                .map(|_| session.compute_sas()),
            frames_received: session.frames_received,
            estimated_percent,
            expected_parts: session.expected_parts,
            debug_log: None, // No last log for polling, only for submit
        })
    }

    /// Cancel receiver session
    pub async fn cancel_import(&self) {
        *self.receiver_session.lock().await = None;
    }

    // === Sender (Old Device) Functions ===

    /// Start export after scanning receiver's Request QR
    pub async fn start_export(
        &self,
        request_json: &str,
        vault_json: &str,
    ) -> Result<ExportSession> {
        let request: ImportRequest =
            serde_json::from_str(request_json).map_err(|e| anyhow!("Invalid request: {}", e))?;

        let session = SenderSession::from_request(&request, vault_json)?;
        let sas_code = session.sas_code.clone();
        let total_frames = session.total_frames();

        *self.sender_session.lock().await = Some(session);

        Ok(ExportSession {
            session_id: request.session_id,
            sas_code,
            total_frames,
        })
    }

    /// Get next animated QR frame
    pub async fn get_export_frame(&self) -> Result<String> {
        let mut session_guard = self.sender_session.lock().await;
        let session = session_guard
            .as_mut()
            .ok_or(anyhow!("No active export session"))?;
        session.next_frame()
    }

    /// Get export SAS code
    pub async fn get_export_sas(&self) -> Result<String> {
        let session_guard = self.sender_session.lock().await;
        let session = session_guard
            .as_ref()
            .ok_or(anyhow!("No active export session"))?;
        Ok(session.sas_code.clone())
    }

    /// Cancel sender session
    pub async fn cancel_export(&self) {
        *self.sender_session.lock().await = None;
    }
}

// For hex encoding session IDs
mod hex {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

    pub fn encode(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            s.push(HEX_CHARS[(b >> 4) as usize] as char);
            s.push(HEX_CHARS[(b & 0x0f) as usize] as char);
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handshake_and_transfer_flow() {
        // 1. Receiver creates request
        let receiver_session = ReceiverSession::new();
        let request = receiver_session.to_request();

        // Check request fields
        assert_eq!(request.v, 1);
        assert_eq!(request.request_type, "boreal-import-request");
        assert!(!request.session_id.is_empty());

        // 2. Sender scans request and starts export
        let vault_data = r#"{"id":"test-vault","name":"My Vault"}"#;
        let mut sender_session = SenderSession::from_request(&request, vault_data)
            .expect("Failed to create sender session");

        // Verify SAS match
        let _receiver_sas = "mock_sas"; // Receiver can't compute SAS until it receives sender pubkey
        let sender_sas = sender_session.sas_code.clone();
        assert_eq!(sender_sas.len(), 6);

        // 3. Sender generates frames
        let mut frames = Vec::new();
        let total = sender_session.total_frames();
        log::info!("Total frames needed: {}", total);

        // Generate enough frames (plus some redundancy although standard fountain codes don't need it for perfect channel)
        for _ in 0..(total + 5) {
            let frame = sender_session.next_frame().expect("Failed to get frame");
            frames.push(frame);
        }

        // 4. Receiver processes frames
        let mut receiver_session = receiver_session; // make mutable
        let mut complete = false;

        for frame in frames {
            let progress = receiver_session
                .receive_frame(&frame)
                .expect("Failed to process frame");

            if progress.complete {
                complete = true;
                // Verify SAS codes match now that receiver has sender's key
                let rec_sas = progress.sas_code.expect("Missing SAS code");
                assert_eq!(rec_sas, sender_sas);
                break;
            }
        }

        assert!(complete, "Transfer failed to complete");

        // 5. Finalize and decrypt
        let decrypted_json = receiver_session
            .complete_import()
            .expect("Failed to decrypt vault");

        assert_eq!(decrypted_json, vault_data);
    }

    #[test]
    fn test_expired_request() {
        let mut receiver = ReceiverSession::new();
        // Manually expire it
        receiver.expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            - 10;

        let request = receiver.to_request();
        let vault_data = "{}";

        let result = SenderSession::from_request(&request, vault_data);
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            "Import request has expired"
        );
    }
    #[test]
    fn test_large_payload_transfer() {
        // 1. Receiver creates request
        let receiver_session = ReceiverSession::new();
        let request = receiver_session.to_request();

        // 2. Sender prepares large vault data (~2KB, needs multiple frames)
        let large_data = "x".repeat(2000);
        let vault_data = format!(r#"{{"id":"large-vault","data":"{}"}}"#, large_data);

        let mut sender_session = SenderSession::from_request(&request, &vault_data)
            .expect("Failed to create sender session");

        let total = sender_session.total_frames();
        assert!(total > 1, "Should require multiple frames");
        log::info!("Total frames needed: {}", total);

        // 3. Transfer process
        let mut receiver_session = receiver_session;
        let mut complete = false;

        // We might need more than 'total' frames due to fountain coding overhead if packets were lost,
        // but here we have a perfect channel so 'total' should be barely enough, maybe +1 or +2.
        // Let's generate 2x to be safe and ensure it completes.
        for i in 0..(total * 2) {
            let frame = sender_session.next_frame().expect("Failed to get frame");

            // Log first few frames to ensure they change
            if i < 5 {
                log::info!("Frame {}: {:.20}...", i, frame);
            }

            let progress = receiver_session
                .receive_frame(&frame)
                .expect("Failed to process frame");

            if progress.complete {
                complete = true;
                log::info!("Completed at frame {}", i);
                break;
            }
        }

        assert!(complete, "Large transfer failed to complete");

        // 4. Decrypt
        let decrypted_json = receiver_session
            .complete_import()
            .expect("Failed to decrypt vault");

        assert_eq!(decrypted_json, vault_data);
    }
}
