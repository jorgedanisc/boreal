import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
// ============ Types ============
export interface VaultPublic {
  id: string;
  name: string;
  bucket: string;
}
// ============ Store Interface ============
interface VaultStore {
  // State
  activeVault: VaultPublic | null;
  vaults: VaultPublic[];
  isLoading: boolean;
  error: string | null;
  // Actions
  loadVaults: () => Promise<void>;
  selectVault: (id: string) => Promise<void>;
  clearActiveVault: () => void;
  setError: (error: string | null) => void;
}
// ============ Store Implementation ============
export const useVaultStore = create<VaultStore>()(
  persist(
    (set) => ({
      // Initial state
      activeVault: null,
      vaults: [],
      isLoading: false,
      error: null,
      // Load all available vaults
      loadVaults: async () => {
        set({ isLoading: true, error: null });
        try {
          const vaults = await invoke<VaultPublic[]>('get_vaults');
          set({ vaults, isLoading: false });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      // Select and load a vault
      selectVault: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          await invoke('load_vault', { id });
          // Initialize upload manager after loading vault
          await invoke('initialize_upload_manager');
          // Get the active vault info
          const activeVault = await invoke<VaultPublic | null>('get_active_vault');
          set({ activeVault, isLoading: false });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
      // Clear the active vault
      clearActiveVault: () => {
        set({ activeVault: null });
      },
      // Set error
      setError: (error: string | null) => {
        set({ error });
      },
    }),
    {
      name: 'boreal-vault-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist the active vault ID for quick restore
        activeVault: state.activeVault,
      }),
    }
  )
);
