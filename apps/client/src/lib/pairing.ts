import { invoke } from '@tauri-apps/api/core';

// ========================
// Types
// ========================

export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
}

export type PairingState =
  | 'idle'
  | 'listening'
  | 'discovering'
  | 'connecting'
  | 'verifying'
  | 'transferring'
  | 'success'
  | 'error';

export interface PairingStatus {
  state: PairingState;
  verification_code: string | null;
  connected_device: string | null;
  error: string | null;
}

// ========================
// Receiver Functions (for importing device)
// ========================

/**
 * Start pairing mode - broadcasts mDNS service and starts HTTP server.
 * The device will be discoverable by other Boreal apps on the same network.
 */
export async function startPairingMode(): Promise<void> {
  try {
    await invoke('start_pairing_mode');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Stop pairing mode - stops mDNS broadcast and HTTP server.
 */
export async function stopPairingMode(): Promise<void> {
  try {
    await invoke('stop_pairing_mode');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Confirm pairing after visually verifying the verification code matches.
 * This allows the sender to proceed with transferring the vault config.
 */
export async function confirmPairing(): Promise<void> {
  try {
    await invoke('confirm_pairing');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get current pairing status including state and verification code.
 */
export async function getPairingStatus(): Promise<PairingStatus> {
  try {
    return await invoke('get_pairing_status');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get the received vault config JSON after successful pairing.
 * Returns null if pairing is not complete.
 */
export async function getReceivedVaultConfig(): Promise<string | null> {
  try {
    return await invoke('get_received_vault_config');
  } catch (e) {
    throw new Error(String(e));
  }
}

// ========================
// Sender Functions (for sharing device)
// ========================

/**
 * Start network discovery - scans for other Boreal devices in pairing mode.
 */
export async function startNetworkDiscovery(): Promise<void> {
  try {
    await invoke('start_network_discovery');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Stop network discovery.
 */
export async function stopNetworkDiscovery(): Promise<void> {
  try {
    await invoke('stop_network_discovery');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get list of discovered devices in pairing mode.
 */
export async function getDiscoveredDevices(): Promise<DiscoveredDevice[]> {
  try {
    return await invoke('get_discovered_devices');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Sender confirms the verification codes match.
 * Call this when the user taps "Match" on the sending device.
 */
export async function confirmPairingAsSender(): Promise<void> {
  try {
    await invoke('confirm_pairing_as_sender');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Initiate pairing with a discovered device.
 * @param deviceId - The ID of the discovered device
 * @param vaultId - The ID of the vault to share
 */
export async function initiatePairing(deviceId: string, vaultId: string): Promise<void> {
  try {
    await invoke('initiate_pairing', { deviceId, vaultId });
  } catch (e) {
    throw new Error(String(e));
  }
}

