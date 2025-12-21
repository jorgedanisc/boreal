/**
 * QR Streaming Vault Transfer API
 *
 * Provides secure vault transfer via two-way QR handshake + animated fountain-coded QR.
 */

import { invoke } from "@tauri-apps/api/core";

// ========================
// Types
// ========================

/** Request QR payload (shown by receiver/new device) */
export interface ImportRequest {
  v: number;
  type: string;
  session_id: string;
  expires_at: number;
  receiver_pub: string;
}

/** Export session info returned to sender */
export interface ExportSession {
  session_id: string;
  sas_code: string;
  total_frames: number;
}

/** Import progress info returned to receiver */
export interface ImportProgress {
  complete: boolean;
  sas_code: string | null;
  frames_received: number;
  estimated_percent: number;
  expected_parts: number | null;
  debug_log?: string;
}

// ========================
// Receiver (New Device) Functions
// ========================

/**
 * Create a new import request.
 * Generates an ephemeral keypair and returns the Request QR payload.
 * The receiver should display this as a QR code for the sender to scan.
 */
export async function createImportRequest(): Promise<ImportRequest> {
  try {
    return await invoke("create_import_request");
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Submit a scanned UR frame from the animated QR.
 * Call this for each frame scanned.
 * @param urString - The UR-encoded string from the QR code
 */
export async function submitImportFrame(urString: string): Promise<ImportProgress> {
  try {
    return await invoke("submit_import_frame", { urString });
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get current import progress.
 */
export async function getImportProgress(): Promise<ImportProgress> {
  try {
    return await invoke("get_import_progress");
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Complete the import after all frames are received.
 * Returns the decrypted vault JSON.
 */
export async function completeQrImport(): Promise<string> {
  try {
    return await invoke("complete_qr_import");
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Cancel the import session.
 */
export async function cancelQrImport(): Promise<void> {
  try {
    await invoke("cancel_qr_import");
  } catch (e) {
    throw new Error(String(e));
  }
}

// ========================
// Sender (Old Device) Functions
// ========================

/**
 * Start export after scanning receiver's Request QR.
 * @param vaultId - ID of the vault to export
 * @param requestJson - JSON string of the scanned ImportRequest
 */
export async function startQrExport(
  vaultId: string,
  requestJson: string
): Promise<ExportSession> {
  try {
    return await invoke("start_qr_export", { vaultId, requestJson });
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get the next UR-encoded frame for the animated QR.
 * Call this repeatedly (e.g., every 100ms) to animate the QR.
 */
export async function getExportFrame(): Promise<string> {
  try {
    return await invoke("get_export_frame");
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get the SAS verification code for this export session.
 */
export async function getExportSas(): Promise<string> {
  try {
    return await invoke("get_export_sas");
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Cancel the export session.
 */
export async function cancelQrExport(): Promise<void> {
  try {
    await invoke("cancel_qr_export");
  } catch (e) {
    throw new Error(String(e));
  }
}
