use anyhow::{anyhow, Result};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use x25519_dalek::{EphemeralSecret, PublicKey};

const SERVICE_TYPE: &str = "_boreal-pair._tcp.local.";
const PAIRING_PORT: u16 = 8847;
const PAIRING_TIMEOUT_SECS: u64 = 180; // 3 minutes

// ========================
// Types
// ========================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PairingState {
    Idle,
    Listening,    // Receiver: mDNS broadcast + HTTP server running
    Discovering,  // Sender: scanning for devices
    Connecting,   // Initiating pairing
    Verifying,    // Waiting for user to verify code
    Transferring, // Sending encrypted vault config
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingStatus {
    pub state: PairingState,
    pub verification_code: Option<String>,
    pub connected_device: Option<String>,
    pub error: Option<String>,
}

impl Default for PairingStatus {
    fn default() -> Self {
        Self {
            state: PairingState::Idle,
            verification_code: None,
            connected_device: None,
            error: None,
        }
    }
}

// ========================
// Pairing Session
// ========================

struct PairingSession {
    session_id: String,
    our_secret: Option<EphemeralSecret>,
    our_public: Option<PublicKey>,
    their_public: Option<PublicKey>,
    shared_secret: Option<[u8; 32]>,
    verification_code: Option<String>,
    vault_config_json: Option<String>,     // Only used by sender
    received_vault_config: Option<String>, // Only used by receiver
    confirmed: bool,
}

impl PairingSession {
    fn new() -> Self {
        let mut session_id = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut session_id);

        let secret = EphemeralSecret::random_from_rng(rand::rngs::OsRng);
        let public = PublicKey::from(&secret);

        Self {
            session_id: hex::encode(&session_id),
            our_secret: Some(secret),
            our_public: Some(public),
            their_public: None,
            shared_secret: None,
            verification_code: None,
            vault_config_json: None,
            received_vault_config: None,
            confirmed: false,
        }
    }

    fn compute_shared_secret(&mut self, their_public_bytes: [u8; 32]) -> Result<()> {
        let their_public = PublicKey::from(their_public_bytes);
        self.their_public = Some(their_public);

        let secret = self
            .our_secret
            .take()
            .ok_or_else(|| anyhow!("Secret already consumed"))?;

        let shared = secret.diffie_hellman(&their_public);
        self.shared_secret = Some(*shared.as_bytes());

        // Generate 6-digit verification code from shared secret + public keys
        self.generate_verification_code()?;

        Ok(())
    }

    fn generate_verification_code(&mut self) -> Result<()> {
        use hmac::{Hmac, Mac};

        let shared = self
            .shared_secret
            .ok_or_else(|| anyhow!("No shared secret"))?;
        let our_pub = self
            .our_public
            .ok_or_else(|| anyhow!("No our public key"))?;
        let their_pub = self
            .their_public
            .ok_or_else(|| anyhow!("No their public key"))?;

        let mut mac =
            Hmac::<Sha256>::new_from_slice(&shared).map_err(|_| anyhow!("HMAC init failed"))?;

        // Include both public keys so both sides derive the same code
        let mut combined = our_pub.as_bytes().to_vec();
        combined.extend_from_slice(their_pub.as_bytes());
        combined.sort(); // Sort to ensure same order on both sides
        mac.update(&combined);
        mac.update(self.session_id.as_bytes());

        let result = mac.finalize().into_bytes();

        // Take first 4 bytes as u32, mod 1_000_000 for 6 digits
        let num = u32::from_be_bytes([result[0], result[1], result[2], result[3]]) % 1_000_000;
        self.verification_code = Some(format!("{:06}", num));

        Ok(())
    }

    fn encrypt_vault_config(&self, vault_json: &str) -> Result<Vec<u8>> {
        let key = self
            .shared_secret
            .ok_or_else(|| anyhow!("No shared secret"))?;
        crate::crypto::encrypt(vault_json.as_bytes(), &key)
    }

    fn decrypt_vault_config(&self, encrypted: &[u8]) -> Result<String> {
        let key = self
            .shared_secret
            .ok_or_else(|| anyhow!("No shared secret"))?;
        let decrypted = crate::crypto::decrypt(encrypted, &key)?;
        String::from_utf8(decrypted).map_err(|e| anyhow!("Invalid UTF-8: {}", e))
    }
}

// ========================
// Pairing Manager
// ========================

pub struct PairingManager {
    status: Arc<RwLock<PairingStatus>>,
    session: Arc<Mutex<Option<PairingSession>>>,
    discovered_devices: Arc<RwLock<HashMap<String, DiscoveredDevice>>>,
    mdns: Arc<Mutex<Option<ServiceDaemon>>>,
    shutdown_tx: Arc<Mutex<Option<broadcast::Sender<()>>>>,
    device_name: String,
}

impl PairingManager {
    pub fn new(device_name: String) -> Self {
        Self {
            status: Arc::new(RwLock::new(PairingStatus::default())),
            session: Arc::new(Mutex::new(None)),
            discovered_devices: Arc::new(RwLock::new(HashMap::new())),
            mdns: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_name,
        }
    }

    pub async fn get_status(&self) -> PairingStatus {
        self.status.read().await.clone()
    }

    async fn set_state(&self, state: PairingState) {
        let mut status = self.status.write().await;
        status.state = state;
    }

    async fn set_error(&self, error: String) {
        let mut status = self.status.write().await;
        status.state = PairingState::Error;
        status.error = Some(error);
    }

    // ========================
    // Receiver Mode (Listening)
    // ========================

    pub async fn start_listening(&self) -> Result<()> {
        // Clean up any existing session first
        self.stop_listening().await;

        // Create session
        {
            let mut session = self.session.lock().await;
            *session = Some(PairingSession::new());
        }

        // Start mDNS broadcast
        if let Err(e) = self.start_mdns_broadcast().await {
            self.set_error(format!("Failed to start mDNS: {}", e)).await;
            return Err(e);
        }

        // Start HTTP server - this is the critical part that can fail with "address in use"
        if let Err(e) = self.start_pairing_server().await {
            self.set_error(format!("Failed to start server: {}", e))
                .await;
            // Clean up mDNS since server failed
            if let Some(mdns) = self.mdns.lock().await.take() {
                let _ = mdns.shutdown();
            }
            return Err(e);
        }

        self.set_state(PairingState::Listening).await;

        // Start timeout
        let status = self.status.clone();
        let shutdown_tx = self.shutdown_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(PAIRING_TIMEOUT_SECS)).await;
            let current_status = status.read().await;
            if current_status.state == PairingState::Listening
                || current_status.state == PairingState::Verifying
            {
                drop(current_status);
                let mut status = status.write().await;
                status.state = PairingState::Error;
                status.error = Some("Pairing timed out".to_string());

                // Send shutdown signal
                if let Some(tx) = shutdown_tx.lock().await.take() {
                    let _ = tx.send(());
                }
            }
        });

        Ok(())
    }

    async fn start_mdns_broadcast(&self) -> Result<()> {
        let mdns = ServiceDaemon::new()?;

        let local_ip =
            local_ip_address::local_ip().map_err(|e| anyhow!("Failed to get local IP: {}", e))?;

        let session_id = {
            let session = self.session.lock().await;
            session
                .as_ref()
                .map(|s| s.session_id.clone())
                .unwrap_or_default()
        };

        let mut txt_properties = HashMap::new();
        txt_properties.insert("name".to_string(), self.device_name.clone());
        txt_properties.insert("session".to_string(), session_id.clone());

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &format!("boreal-{}", &session_id[..8]),
            &format!("{}.local.", local_ip),
            local_ip.to_string(),
            PAIRING_PORT,
            txt_properties,
        )?;

        mdns.register(service_info)?;

        *self.mdns.lock().await = Some(mdns);

        Ok(())
    }

    async fn start_pairing_server(&self) -> Result<()> {
        let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);

        let session = self.session.clone();
        let status = self.status.clone();

        let app_state = AppState {
            session: session.clone(),
            status: status.clone(),
        };

        let router = Router::new()
            .route("/initiate", post(handle_initiate))
            .route("/status", get(handle_status))
            .route("/transfer", post(handle_transfer))
            .with_state(app_state);

        let addr = SocketAddr::from(([0, 0, 0, 0], PAIRING_PORT));

        // Bind synchronously to catch errors immediately
        let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
            anyhow!(
                "Port {} is already in use. Please close other pairing sessions first: {}",
                PAIRING_PORT,
                e
            )
        })?;

        let status_for_task = status.clone();
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.recv().await;
                })
                .await
            {
                eprintln!("[Pairing] Server error: {}", e);
                let mut s = status_for_task.write().await;
                s.state = PairingState::Error;
                s.error = Some(format!("Server error: {}", e));
            }
        });

        Ok(())
    }

    pub async fn confirm_pairing(&self) -> Result<()> {
        let mut session = self.session.lock().await;
        if let Some(ref mut s) = *session {
            s.confirmed = true;
            self.set_state(PairingState::Transferring).await;
            Ok(())
        } else {
            Err(anyhow!("No active session"))
        }
    }

    pub async fn stop_listening(&self) {
        // Stop mDNS
        if let Some(mdns) = self.mdns.lock().await.take() {
            let _ = mdns.shutdown();
        }

        // Stop HTTP server
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }

        // Clear session
        *self.session.lock().await = None;
        *self.status.write().await = PairingStatus::default();
    }

    pub async fn get_received_vault_config(&self) -> Option<String> {
        let session = self.session.lock().await;
        session
            .as_ref()
            .and_then(|s| s.received_vault_config.clone())
    }

    // ========================
    // Sender Mode (Discovering)
    // ========================

    pub async fn start_discovery(&self) -> Result<()> {
        let mdns = ServiceDaemon::new()?;
        let receiver = mdns.browse(SERVICE_TYPE)?;

        *self.mdns.lock().await = Some(mdns);
        self.set_state(PairingState::Discovering).await;

        let devices = self.discovered_devices.clone();

        tokio::spawn(async move {
            while let Ok(event) = receiver.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let id = info.get_fullname().to_string();
                        let name = info
                            .get_property_val_str("name")
                            .unwrap_or("Unknown Device")
                            .to_string();

                        if let Some(addr) = info.get_addresses().iter().next() {
                            let device = DiscoveredDevice {
                                id: id.clone(),
                                name,
                                ip: addr.to_string(),
                                port: info.get_port(),
                            };

                            devices.write().await.insert(id, device);
                        }
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => {
                        devices.write().await.remove(&fullname);
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub async fn stop_discovery(&self) {
        if let Some(mdns) = self.mdns.lock().await.take() {
            let _ = mdns.shutdown();
        }
        self.discovered_devices.write().await.clear();
        *self.status.write().await = PairingStatus::default();
    }

    pub async fn get_discovered_devices(&self) -> Vec<DiscoveredDevice> {
        self.discovered_devices
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    pub async fn initiate_pairing(
        &self,
        device: &DiscoveredDevice,
        vault_json: String,
    ) -> Result<()> {
        // Create our session
        let mut session = PairingSession::new();
        session.vault_config_json = Some(vault_json.clone());

        let our_public_bytes = session
            .our_public
            .ok_or_else(|| anyhow!("No public key"))?
            .to_bytes();

        self.set_state(PairingState::Connecting).await;

        // Send initiate request to receiver
        let url = format!("http://{}:{}/initiate", device.ip, device.port);
        let client = reqwest::Client::new();

        let response: InitiateResponse = client
            .post(&url)
            .json(&InitiateRequest {
                sender_public_key: our_public_bytes,
            })
            .send()
            .await
            .map_err(|e| anyhow!("Failed to connect: {}", e))?
            .json()
            .await
            .map_err(|e| anyhow!("Invalid response: {}", e))?;

        // Compute shared secret
        session.compute_shared_secret(response.receiver_public_key)?;

        // Update status with verification code
        {
            let mut status = self.status.write().await;
            status.state = PairingState::Verifying;
            status.verification_code = session.verification_code.clone();
            status.connected_device = Some(device.name.clone());
        }

        *self.session.lock().await = Some(session);

        // Poll for confirmation, then transfer
        let session = self.session.clone();
        let status = self.status.clone();
        let device_ip = device.ip.clone();
        let device_port = device.port;

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let status_url = format!("http://{}:{}/status", device_ip, device_port);
            let transfer_url = format!("http://{}:{}/transfer", device_ip, device_port);

            // Poll status until confirmed
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                let resp = match client.get(&status_url).send().await {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                let status_resp: StatusResponse = match resp.json().await {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                if status_resp.confirmed {
                    // Transfer the vault config
                    let session_guard = session.lock().await;
                    if let Some(ref s) = *session_guard {
                        if let Some(ref vault_json) = s.vault_config_json {
                            if let Ok(encrypted) = s.encrypt_vault_config(vault_json) {
                                let encoded = base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &encrypted,
                                );

                                drop(session_guard);

                                let _ = client
                                    .post(&transfer_url)
                                    .json(&TransferRequest {
                                        encrypted_config: encoded,
                                    })
                                    .send()
                                    .await;

                                status.write().await.state = PairingState::Success;
                            }
                        }
                    }
                    break;
                }
            }
        });

        Ok(())
    }
}

// ========================
// HTTP Handlers (Receiver)
// ========================

#[derive(Clone)]
struct AppState {
    session: Arc<Mutex<Option<PairingSession>>>,
    status: Arc<RwLock<PairingStatus>>,
}

#[derive(Serialize, Deserialize)]
struct InitiateRequest {
    sender_public_key: [u8; 32],
}

#[derive(Serialize, Deserialize)]
struct InitiateResponse {
    receiver_public_key: [u8; 32],
    session_id: String,
}

async fn handle_initiate(
    State(state): State<AppState>,
    Json(req): Json<InitiateRequest>,
) -> Result<Json<InitiateResponse>, StatusCode> {
    let mut session = state.session.lock().await;

    if let Some(ref mut s) = *session {
        // Compute shared secret from sender's public key
        s.compute_shared_secret(req.sender_public_key)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let our_public = s
            .our_public
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .to_bytes();

        // Update status
        {
            let mut status = state.status.write().await;
            status.state = PairingState::Verifying;
            status.verification_code = s.verification_code.clone();
        }

        Ok(Json(InitiateResponse {
            receiver_public_key: our_public,
            session_id: s.session_id.clone(),
        }))
    } else {
        Err(StatusCode::SERVICE_UNAVAILABLE)
    }
}

#[derive(Serialize, Deserialize)]
struct StatusResponse {
    confirmed: bool,
}

async fn handle_status(State(state): State<AppState>) -> Json<StatusResponse> {
    let session = state.session.lock().await;
    let confirmed = session.as_ref().map(|s| s.confirmed).unwrap_or(false);
    Json(StatusResponse { confirmed })
}

#[derive(Serialize, Deserialize)]
struct TransferRequest {
    encrypted_config: String,
}

#[derive(Serialize, Deserialize)]
struct TransferResponse {
    success: bool,
}

async fn handle_transfer(
    State(state): State<AppState>,
    Json(req): Json<TransferRequest>,
) -> Result<Json<TransferResponse>, StatusCode> {
    let mut session = state.session.lock().await;

    if let Some(ref mut s) = *session {
        if !s.confirmed {
            return Err(StatusCode::FORBIDDEN);
        }

        // Decode and decrypt
        let encrypted = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &req.encrypted_config,
        )
        .map_err(|_| StatusCode::BAD_REQUEST)?;

        let decrypted = s
            .decrypt_vault_config(&encrypted)
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        s.received_vault_config = Some(decrypted);

        // Update status to success
        state.status.write().await.state = PairingState::Success;

        Ok(Json(TransferResponse { success: true }))
    } else {
        Err(StatusCode::SERVICE_UNAVAILABLE)
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
