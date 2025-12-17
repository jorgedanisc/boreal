import { IconPlus, IconUpload } from '@tabler/icons-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useUploadStore } from '../../stores/upload_store';
interface UploadTriggerProps {
  variant?: 'button' | 'fab';
  className?: string;
}
const SUPPORTED_EXTENSIONS = [
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'avif',
  'raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'sr2',
  // Videos
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'ts',
  // Audio
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'aiff', 'alac',
];
export function UploadTrigger({ variant = 'button', className = '' }: UploadTriggerProps) {
  const { addFiles } = useUploadStore();
  const handleClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Media Files',
            extensions: SUPPORTED_EXTENSIONS,
          },
        ],
      });
      if (selected && Array.isArray(selected) && selected.length > 0) {
        const result = await addFiles(selected);
        // If auto-disabled, the store already updated, but we could show a toast here
        if (result.autoDisabled) {
          console.log(
            'Fresh Upload was auto-disabled due to large upload size (>1000 files or >20GB)'
          );
        }
      }
    } catch (error) {
      console.error('Failed to open file picker:', error);
    }
  };
  if (variant === 'fab') {
    return (
      <button
        onClick={handleClick}
        className={`fixed bottom-24 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all hover:scale-105 flex items-center justify-center z-40 ${className}`}
        title="Upload files"
      >
        <IconPlus className="h-6 w-6" />
      </button>
    );
  }
  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors ${className}`}
    >
      <IconUpload className="h-4 w-4" />
      Upload
    </button>
  );
}
