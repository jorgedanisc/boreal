import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { queueManifestSync } from '@/lib/vault';

// ============ Types ============

export type MediaType = 'Image' | 'Video' | 'Audio';

export type UploadStatus =
  | 'Pending'
  | 'Processing'
  | 'EncryptingOriginal'
  | 'EncryptingThumbnail'
  | { UploadingOriginal: { progress: number } }
  | { UploadingThumbnail: { progress: number } }
  | 'Completed'
  | { Failed: { error: string } }
  | 'Cancelled'
  | 'Failed'
  | 'Paused';

export interface UploadFile {
  id: string;
  path: string;
  filename: string;
  size: number;
  status: UploadStatus;
  progress: number;
  mediaType: MediaType;
  freshUpload: boolean;
  bytesUploaded: number;
  retryCount: number;
  pre_generated_frames?: string[];
}

export interface QueueState {
  items: UploadFile[];
  totalSize: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

interface AddFilesResult {
  items: UploadFile[];
  fresh_upload_auto_disabled: boolean;
}

// ============ Store Interface ============

interface UploadStore {
  // State
  files: UploadFile[];
  freshUploadEnabled: boolean;
  isMinimized: boolean;
  isProcessing: boolean;
  uploadSession: string | null;

  // Actions
  addFiles: (paths: string[], thumbnails?: Record<string, string[]>) => Promise<{ autoDisabled: boolean }>;
  removeFile: (id: string) => Promise<void>;
  cancelFile: (id: string) => Promise<void>;
  pauseFile: (id: string) => Promise<void>;
  resumeFile: (id: string) => Promise<void>;
  retryFile: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  clearPending: () => void;
  startUpload: () => Promise<void>;
  toggleFreshUpload: () => void;
  setFreshUpload: (enabled: boolean) => void;
  toggleMinimized: () => void;
  updateFileProgress: (id: string, progress: number, status: UploadStatus, bytesUploaded?: number) => void;
  markFileCompleted: (id: string) => void;
  markFileFailed: (id: string, error: string) => void;
  syncFromBackend: () => Promise<void>;
  initializeListeners: () => Promise<() => void>;

  // Computed getters (as functions since Zustand doesn't have computed)
  getTotalSize: () => number;
  getTotalBytesUploaded: () => number;
  getOverallProgress: () => number;
  getCompletedCount: () => number;
  getPendingCount: () => number;
  getFailedCount: () => number;
  getActiveCount: () => number;
  getPausedCount: () => number;
  getFilesSortedBySize: () => UploadFile[];
  getFilesByMediaType: () => Record<MediaType, UploadFile[]>;
}

// ============ Helper Functions ============

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  return formatFileSize(bytesPerSecond) + '/s';
}

function getStatusLabel(status: UploadStatus): string {
  if (typeof status === 'string') {
    switch (status) {
      case 'Pending':
        return 'Waiting...';
      case 'Processing':
        return 'Processing...';
      case 'EncryptingOriginal':
        return 'Encrypting...';
      case 'EncryptingThumbnail':
        return 'Creating thumbnail...';
      case 'Completed':
        return 'Done';
      case 'Cancelled':
        return 'Cancelled';
      case 'Paused':
        return 'Paused';
      default:
        return status;
    }
  }

  if ('UploadingOriginal' in status) {
    return `Uploading ${Math.round(status.UploadingOriginal.progress * 100)}%`;
  }
  if ('UploadingThumbnail' in status) {
    return `Thumbnail ${Math.round(status.UploadingThumbnail.progress * 100)}%`;
  }
  if ('Failed' in status) {
    return `Failed: ${status.Failed.error}`;
  }
  return 'Unknown';
}

function isStatusFinal(status: UploadStatus): boolean {
  return (
    status === 'Completed' ||
    status === 'Cancelled' ||
    (typeof status === 'object' && 'Failed' in status)
  );
}

function isStatusActive(status: UploadStatus): boolean {
  return (
    status !== 'Pending' &&
    status !== 'Completed' &&
    status !== 'Cancelled' &&
    status !== 'Paused' &&
    !(typeof status === 'object' && 'Failed' in status)
  );
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============ Store Implementation ============

export const useUploadStore = create<UploadStore>()(
  persist(
    (set, get) => ({
      // Initial state
      files: [],
      freshUploadEnabled: true, // Enabled by default per user requirement
      isMinimized: false,
      isProcessing: false,
      uploadSession: null,

      // Add files to the queue
      addFiles: async (paths: string[], thumbnails?: Record<string, string[]>) => {
        try {
          const result = await invoke<AddFilesResult>('add_files_to_queue', {
            payload: {
              paths,
              fresh_upload: get().freshUploadEnabled,
              thumbnails,
            },
          });

          // If auto-disabled, update the toggle
          if (result.fresh_upload_auto_disabled) {
            set({ freshUploadEnabled: false });
          }

          // Create upload session if not exists
          const currentSession = get().uploadSession;
          const session = currentSession || generateSessionId();

          // Add new files to state
          set((state) => ({
            uploadSession: session,
            isMinimized: false, // Auto-expand panel when files are added
            files: [
              ...state.files,
              ...result.items.map((item) => {
                const frames = thumbnails?.[item.path];
                // console.log('[Store Debug] item.path:', item.path, 'thumbnails keys:', thumbnails ? Object.keys(thumbnails) : [], 'match:', !!frames, 'mediaType:', item.mediaType);
                return {
                  id: item.id,
                  path: item.path,
                  filename: item.filename,
                  size: item.size,
                  status: item.status,
                  progress: item.progress,
                  mediaType: item.mediaType,
                  freshUpload: item.freshUpload,
                  bytesUploaded: 0,
                  retryCount: 0,
                  // Map backend path to input thumbnails if available
                  pre_generated_frames: frames,
                };
              }),
            ],
          }));

          return { autoDisabled: result.fresh_upload_auto_disabled };
        } catch (error) {
          console.error('Failed to add files:', error);
          throw error;
        }
      },

      // Remove a file from the queue (frontend only, for UX)
      removeFile: async (id: string) => {
        try {
          await invoke('remove_upload_item', { id });
          set((state) => ({
            files: state.files.filter((f) => f.id !== id),
          }));
        } catch (error) {
          console.error('Failed to remove file:', error);
          // Optimistic update fallback? Or just error.
        }
      },

      // Cancel a file upload
      cancelFile: async (id: string) => {
        try {
          await invoke('cancel_upload', { id });
          set((state) => {
            const updatedFiles = state.files.map((f) =>
              f.id === id ? { ...f, status: 'Cancelled' as UploadStatus } : f
            );

            // Check if all files are now final (Completed, Cancelled, or Failed)
            const allDone = updatedFiles.every((f) => isStatusFinal(f.status));

            return {
              files: updatedFiles,
              isProcessing: allDone ? false : state.isProcessing // Stop processing if everything is done/cancelled
            };
          });
        } catch (error) {
          console.error('Failed to cancel upload:', error);
        }
      },

      // Pause a file upload
      pauseFile: async (id: string) => {
        try {
          await invoke('pause_upload', { id });
          set((state) => ({
            files: state.files.map((f) =>
              f.id === id ? { ...f, status: 'Paused' as UploadStatus } : f
            ),
          }));
        } catch (error) {
          console.error('Failed to pause upload:', error);
        }
      },

      // Resume a paused upload
      resumeFile: async (id: string) => {
        try {
          await invoke('resume_upload', { id });
          set((state) => ({
            files: state.files.map((f) =>
              f.id === id ? { ...f, status: 'Pending' as UploadStatus } : f
            ),
          }));
        } catch (error) {
          console.error('Failed to resume upload:', error);
        }
      },

      // Retry a failed upload
      retryFile: async (id: string) => {
        try {
          await invoke('retry_upload', { id });
          set((state) => ({
            files: state.files.map((f) =>
              f.id === id
                ? {
                  ...f,
                  status: 'Pending' as UploadStatus,
                  progress: 0,
                  bytesUploaded: 0,
                }
                : f
            ),
          }));
        } catch (error) {
          console.error('Failed to retry upload:', error);
        }
      },

      // Clear finished (completed/failed/cancelled) items
      clearFinished: async () => {
        try {
          await invoke('clear_finished_uploads');
          const remainingFiles = get().files.filter((f) => !isStatusFinal(f.status));
          set({
            files: remainingFiles,
            // Clear session if no files remain
            uploadSession: remainingFiles.length > 0 ? get().uploadSession : null,
          });
        } catch (error) {
          console.error('Failed to clear finished:', error);
        }
      },

      // Start uploading
      startUpload: async () => {
        set({ isProcessing: true });
        try {
          // Pass the current freshUploadEnabled state to apply to all pending items
          await invoke('start_upload', {
            payload: {
              fresh_upload: get().freshUploadEnabled,
            },
          });
        } catch (error) {
          console.error('Failed to start upload:', error);
          set({ isProcessing: false });
          throw error;
        }
      },

      // Toggle Fresh Upload mode
      toggleFreshUpload: () => {
        set((state) => ({ freshUploadEnabled: !state.freshUploadEnabled }));
      },

      // Set Fresh Upload mode explicitly
      setFreshUpload: (enabled: boolean) => {
        set({ freshUploadEnabled: enabled });
      },

      // Toggle minimized state
      toggleMinimized: () => {
        set((state) => ({ isMinimized: !state.isMinimized }));
      },

      // Update file progress (called by event listener)
      updateFileProgress: (id: string, progress: number, status: UploadStatus, bytesUploaded?: number) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.id === id
              ? {
                ...f,
                progress,
                status,
                bytesUploaded: bytesUploaded ?? f.bytesUploaded,
              }
              : f
          ),
        }));
      },

      // Clear all pending files
      clearPending: () => {
        set((state) => ({
          files: state.files.filter((f) =>
            f.status !== 'Pending' && !('Failed' in f) && f.status !== 'Cancelled'
          ),
        }));
      },

      // Mark file as completed
      markFileCompleted: (id: string) => {
        set((state) => {
          const updatedFiles = state.files.map((f) =>
            f.id === id
              ? {
                ...f,
                status: 'Completed' as UploadStatus,
                progress: 1,
                bytesUploaded: f.size,
              }
              : f
          );

          const allDone = updatedFiles.every((f) => isStatusFinal(f.status));

          // Queue manifest sync when all uploads complete
          if (allDone && updatedFiles.some((f) => f.status === 'Completed')) {
            queueManifestSync();
          }

          return {
            files: updatedFiles,
            isProcessing: allDone ? false : state.isProcessing
          };
        });
      },

      // Mark file as failed
      markFileFailed: (id: string, error: string) => {
        set((state) => {
          const updatedFiles = state.files.map((f) =>
            f.id === id
              ? { ...f, status: { Failed: { error } } as UploadStatus }
              : f
          );

          const allDone = updatedFiles.every((f) => isStatusFinal(f.status));

          return {
            files: updatedFiles,
            isProcessing: allDone ? false : state.isProcessing
          };
        });
      },

      // Sync state from backend
      syncFromBackend: async () => {
        try {
          const state = await invoke<QueueState>('get_upload_queue_status');
          set({
            files: state.items.map((item) => ({
              id: item.id,
              path: item.path,
              filename: item.filename,
              size: item.size,
              status: item.status,
              progress: item.progress,
              mediaType: item.mediaType,
              freshUpload: item.freshUpload,
              bytesUploaded: (item as UploadFile).bytesUploaded || 0,
              retryCount: (item as UploadFile).retryCount || 0,
            })),
          });
        } catch (error) {
          console.error('Failed to sync from backend:', error);
        }
      },

      // Initialize Tauri event listeners
      initializeListeners: async () => {
        const unlistenProgress = await listen<{
          id: string;
          progress?: number;
          status?: UploadStatus;
          bytes_uploaded?: number;
          total_bytes?: number;
        }>('upload:progress', (event) => {
          const { id, progress, status, bytes_uploaded } = event.payload;
          if (progress !== undefined && status !== undefined) {
            get().updateFileProgress(id, progress, status, bytes_uploaded);
          }
        });

        const unlistenCompleted = await listen<{ id: string }>(
          'upload:completed',
          (event) => {
            get().markFileCompleted(event.payload.id);
          }
        );

        const unlistenFailed = await listen<{ id: string; error: string }>(
          'upload:failed',
          (event) => {
            get().markFileFailed(event.payload.id, event.payload.error);
          }
        );

        // Return cleanup function
        return () => {
          unlistenProgress();
          unlistenCompleted();
          unlistenFailed();
        };
      },

      // Computed getters
      getTotalSize: () => {
        return get().files.reduce((sum, f) => sum + f.size, 0);
      },

      getTotalBytesUploaded: () => {
        return get().files.reduce((sum, f) => sum + f.bytesUploaded, 0);
      },

      getOverallProgress: () => {
        const totalSize = get().getTotalSize();
        if (totalSize === 0) return 0;
        return get().getTotalBytesUploaded() / totalSize;
      },

      getCompletedCount: () => {
        return get().files.filter((f) => f.status === 'Completed').length;
      },

      getPendingCount: () => {
        return get().files.filter(
          (f) => f.status === 'Pending' || f.status === 'Processing'
        ).length;
      },

      getFailedCount: () => {
        return get().files.filter(
          (f) => typeof f.status === 'object' && 'Failed' in f.status
        ).length;
      },

      getActiveCount: () => {
        return get().files.filter((f) => isStatusActive(f.status)).length;
      },

      getPausedCount: () => {
        return get().files.filter((f) => f.status === 'Paused').length;
      },

      getFilesSortedBySize: () => {
        return [...get().files].sort((a, b) => b.size - a.size);
      },

      getFilesByMediaType: () => {
        const grouped: Record<MediaType, UploadFile[]> = {
          Image: [],
          Video: [],
          Audio: [],
        };
        get().files.forEach((f) => {
          grouped[f.mediaType].push(f);
        });
        return grouped;
      },
    }),
    {
      name: 'boreal-upload-queue-v2', // New version key for migration
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: unknown, version: number) => {
        // Handle migration from v1 to v2
        if (version < 2) {
          // Clear old state and start fresh
          return {
            files: [],
            freshUploadEnabled: true,
            isMinimized: false,
            isProcessing: false,
            uploadSession: null,
          };
        }
        return persistedState as UploadStore;
      },
      partialize: (state) => ({
        // Only persist these fields
        // Only persist pending/failed files to save space, and strip frames
        files: state.files
          .filter(f => !isStatusFinal(f.status) || typeof f.status === 'object') // Keep pending or failed
          .map((f) => {
            const { pre_generated_frames, ...rest } = f;
            return rest;
          }),
        freshUploadEnabled: state.freshUploadEnabled,
        isMinimized: state.isMinimized,
        // uploadSession: state.uploadSession, // Don't persist session objects if not needed
      }),
    }
  )
);

// Export helpers
export { formatFileSize, formatSpeed, getStatusLabel, isStatusFinal, isStatusActive };

