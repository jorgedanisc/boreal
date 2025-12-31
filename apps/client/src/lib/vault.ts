import { invoke } from '@tauri-apps/api/core';

export interface VaultConfig {
  access_key_id: string;
  secret_access_key: string;
  region: string;
  bucket: string;
  vault_key: string;
}

export interface VaultPublic {
  id: string;
  name: string;
  bucket: string;
  visits: number;
  total_size_bytes: number;
}

export async function getVaults(): Promise<VaultPublic[]> {
  try {
    return await invoke('get_vaults');
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function renameVault(id: string, newName: string): Promise<void> {
  try {
    await invoke('rename_vault', { id, newName });
    // Sync manifest to propagate rename to other devices
    queueManifestSync();
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function deleteVault(id: string, deleteCloud: boolean): Promise<void> {
  try {
    await invoke('delete_vault', { id, deleteCloud });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function getActiveVault(): Promise<VaultPublic | null> {
  try {
    return await invoke('get_active_vault');
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function exportVault(id: string): Promise<string> {
  try {
    return await invoke('export_vault', { id });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function loadVault(id: string): Promise<void> {
  try {
    await invoke('load_vault', { id });
    // Trigger progressive cache sync in the background (non-blocking)
    syncThumbnailCache().then((count) => {
      if (count > 0) {
        console.log(`[Cache Sync] Fetched ${count} missing thumbnails`);
      }
    });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function importVault(vaultCode: string): Promise<void> {
  try {
    await invoke('import_vault', { vaultCode });
  } catch (e) {
    throw new Error(String(e));
  }
}

// Step-by-step import for debugging
export async function importVaultStep1Save(vaultCode: string): Promise<string> {
  try {
    return await invoke('import_vault_step1_save', { vaultCode });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function importVaultStep2Load(vaultId: string): Promise<void> {
  try {
    await invoke('import_vault_step2_load', { vaultId });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function importVaultStep3Sync(): Promise<string> {
  try {
    return await invoke('import_vault_step3_sync');
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function bootstrapVault(vaultCode: string): Promise<void> {
  try {
    await invoke('bootstrap_vault', { vaultCode });
  } catch (e) {
    throw new Error(String(e));
  }
}

export interface ExportViewData {
  qr_url: string;
  pin: string;
}

export async function createExportQr(id: string): Promise<ExportViewData> {
  try {
    return await invoke('create_export_qr', { id });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function decryptImport(encryptedData: string, pin: string): Promise<string> {
  try {
    return await invoke('decrypt_import', { encryptedData, pin });
  } catch (e) {
    throw new Error(String(e));
  }
}

export interface Photo {
  id: string;
  filename: string;
  created_at: string;
  captured_at?: string;
  tier: string;
  width: number;
  height: number;
  s3_key: string;
  media_type: 'image' | 'video' | 'audio';
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  lens_model?: string;
  iso?: number;
  f_number?: number;
  exposure_time?: string;
}

export async function getPhotos(): Promise<Photo[]> {
  try {
    return await invoke('get_photos');
  } catch (e) {
    throw new Error(String(e));
  }
}

// ============ Cross-Vault Types & Functions (for Search/Map) ============

export interface PhotoWithVault extends Photo {
  vault_id: string;
}

export interface GeoPhoto {
  id: string;
  vault_id: string;
  latitude: number;
  longitude: number;
  captured_at?: string;
  // Extended fields for Lightbox
  filename: string;
  created_at: string;
  width: number;
  height: number;
  make?: string;
  model?: string;
  lens_model?: string;
  iso?: number;
  f_number?: number;
  exposure_time?: string;
}

/**
 * Get all photos from all vaults (for cross-vault search)
 */
export async function getAllPhotos(): Promise<PhotoWithVault[]> {
  try {
    return await invoke('get_all_photos');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get all photos with geolocation data from all vaults (for map display)
 */
export async function getAllPhotosWithGeolocation(): Promise<GeoPhoto[]> {
  try {
    return await invoke('get_all_photos_with_geolocation');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get thumbnail for a photo from a specific vault
 * @param id Photo ID
 * @param vaultId Vault ID containing the photo
 */
export async function getThumbnailForVault(id: string, vaultId: string): Promise<string> {
  try {
    return await invoke('get_thumbnail_for_vault', { id, vaultId });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function getThumbnail(id: string): Promise<string> {
  try {
    return await invoke('get_thumbnail', { id });
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function uploadPhoto(path: string): Promise<void> {
  try {
    await invoke('upload_photo', { path });
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Sync thumbnail cache - checks manifest against local cache and fetches missing thumbnails.
 * Call this after vault load to progressively cache thumbnails for offline access.
 * @returns Number of thumbnails that were fetched and cached
 */
export async function syncThumbnailCache(): Promise<number> {
  try {
    return await invoke('sync_thumbnail_cache');
  } catch (e) {
    console.error('Failed to sync thumbnail cache:', e);
    return 0; // Don't throw, this is non-critical
  }
}

/**
 * Open the cache folder for the current vault in the system file explorer.
 */
export async function openCacheFolder(): Promise<void> {
  try {
    await invoke('open_cache_folder');
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Get audio file for playback. Fetches from S3, decrypts, and returns base64.
 * This is called on-demand when user clicks play (cost-efficient).
 * @param id The audio file ID
 * @returns Base64 encoded audio data
 */

export async function getAudio(id: string): Promise<string> {
  try {
    return await invoke('get_audio', { id });
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * Checks if biometric authentication is available.
 * @returns boolean indicating availability 
 */
export async function checkBiometrics(): Promise<boolean> {
  try {
    return await invoke('check_biometrics');
  } catch (e) {
    console.error("Biometrics check failed or unavailable:", e);
    return false;
  }
}

/**
 * Prompts the user for biometric authentication (Touch ID, Face ID, Windows Hello, or password fallback).
 * @param reason The reason to display to the user
 * @throws if authentication fails or is cancelled
 */
export async function authenticateBiometrics(reason: string): Promise<void> {
  return await invoke('authenticate_biometrics', { reason });
}

// Manifest Sync Functions

/**
 * Upload the local manifest to S3. Call this after data changes
 * (memories created/updated, photos uploaded, vault renamed).
 */
export async function syncManifestUpload(): Promise<void> {
  try {
    await invoke('sync_manifest_upload');
  } catch (e) {
    console.error('Manifest upload failed:', e);
    // Non-critical, don't throw - manifest will sync on next opportunity
  }
}

/**
 * Download and merge the manifest from S3 into local DB.
 * This is called automatically on vault load, but can be triggered manually.
 * After sync, triggers background embedding of cached photos.
 */
export async function syncManifestDownload(): Promise<void> {
  try {
    await invoke('sync_manifest_download');

    // After syncing manifest, embed any cached photos that haven't been embedded yet
    invoke('embed_all_photos').then((count) => {
      if (typeof count === 'number' && count > 0) {
        console.log(`[AI] Embedded ${count} new photos after manifest sync`);
      }
    }).catch((e) => {
      // AI embedding is optional, don't fail the sync
      console.debug('Background embedding skipped:', e);
    });
  } catch (e) {
    console.error('Manifest download failed:', e);
    // Non-critical, don't throw
  }
}

// Debounced manifest upload (5 seconds after last change)
let manifestUploadTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Queue a manifest upload (debounced). Call this after any data change.
 * Will upload the manifest 5 seconds after the last call.
 */
export function queueManifestSync(): void {
  if (manifestUploadTimeout) {
    clearTimeout(manifestUploadTimeout);
  }
  manifestUploadTimeout = setTimeout(() => {
    syncManifestUpload();
    manifestUploadTimeout = null;
  }, 5000);
}

