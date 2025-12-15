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
}

export async function getVaults(): Promise<VaultPublic[]> {
  try {
    return await invoke('get_vaults');
  } catch (e) {
    throw new Error(String(e));
  }
}

export async function loadVault(id: string): Promise<void> {
  try {
    await invoke('load_vault', { id });
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

export async function bootstrapVault(vaultCode: string): Promise<void> {
  try {
    await invoke('bootstrap_vault', { vaultCode });
  } catch (e) {
    throw new Error(String(e));
  }
}

export interface Photo {
  id: string;
  filename: string;
  created_at: string;
  tier: string;
}

export async function getPhotos(): Promise<Photo[]> {
  try {
    return await invoke('get_photos');
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
