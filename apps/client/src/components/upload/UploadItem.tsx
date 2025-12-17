import {
  IconFile,
  IconPhoto,
  IconVideo,
  IconMusic,
  IconCheck,
  IconX,
  IconRefresh,
  IconPlayerPause,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { useUploadStore, isStatusFinal, isStatusActive } from '../../stores/upload_store';
import type { UploadFile } from '../../stores/upload_store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';

function getMediaIcon(mediaType: string) {
  switch (mediaType) {
    case 'Image':
      return <IconPhoto className="h-4 w-4 text-blue-500" />;
    case 'Video':
      return <IconVideo className="h-4 w-4 text-purple-500" />;
    case 'Audio':
      return <IconMusic className="h-4 w-4 text-green-500" />;
    default:
      return <IconFile className="h-4 w-4 text-muted-foreground" />;
  }
}

function getProgress(file: UploadFile): number {
  const status = file.status;

  // Use byte-level progress if available
  if (file.bytesUploaded > 0 && file.size > 0) {
    return (file.bytesUploaded / file.size) * 100;
  }

  // Fallback to status-based estimation
  if (file.progress > 0) return file.progress * 100;

  if (status === 'Pending') return 0;
  if (status === 'Processing') return 10;
  if (status === 'EncryptingOriginal') return 20;
  if (status === 'EncryptingThumbnail') return 30;
  if (status === 'Paused') return file.progress * 100;
  if (typeof status === 'object' && 'UploadingOriginal' in status) {
    return 40 + status.UploadingOriginal.progress * 30;
  }
  if (typeof status === 'object' && 'UploadingThumbnail' in status) {
    return 70 + status.UploadingThumbnail.progress * 25;
  }
  if (status === 'Completed') return 100;
  return 0;
}

interface UploadItemProps {
  file: UploadFile;
}

export function UploadItem({ file }: UploadItemProps) {
  const { cancelFile, pauseFile, resumeFile, retryFile } = useUploadStore();

  const progress = getProgress(file);
  const isFinal = isStatusFinal(file.status);
  const isFailed = typeof file.status === 'object' && 'Failed' in file.status;
  const isPaused = file.status === 'Paused';
  const isActive = isStatusActive(file.status);
  const isCompleted = file.status === 'Completed';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors relative"
    >
      <div className="shrink-0 mt-0.5">{getMediaIcon(file.mediaType)}</div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center justify-between">
          <span className={cn("text-sm font-medium truncate pr-2", isFinal && !isCompleted && !isFailed && "text-muted-foreground")}>
            {file.filename}
          </span>
          {/* Status / Percentage */}
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {isFailed ? "Failed" : isCompleted ? "Done" : `${Math.round(progress)}%`}
          </span>
        </div>

        {/* Progress Bar Line */}
        {!isFinal && (
          <div className="h-1 w-full bg-muted/50 rounded-full mt-1.5 overflow-hidden">
            <motion.div
              className={cn(
                "h-full rounded-full",
                isPaused ? "bg-amber-500" : isFailed ? "bg-destructive" : "bg-primary"
              )}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}

        {isFailed && (
          <p className="text-[10px] text-destructive mt-0.5 truncate">
            {(file.status as any).Failed.error || "Unknown error"}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
        {isActive && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => pauseFile(file.id)} title="Pause">
            <IconPlayerPause className="h-3 w-3" />
          </Button>
        )}
        {isPaused && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full text-amber-500" onClick={() => resumeFile(file.id)} title="Resume">
            <IconPlayerPlay className="h-3 w-3" />
          </Button>
        )}
        {isFailed && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full text-destructive" onClick={() => retryFile(file.id)} title="Retry">
            <IconRefresh className="h-3 w-3" />
          </Button>
        )}
        {!isFinal && !isCompleted && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => cancelFile(file.id)} title="Cancel">
            <IconX className="h-3 w-3" />
          </Button>
        )}
        {isCompleted && (
          <IconCheck className="h-4 w-4 text-green-500" />
        )}
      </div>
    </motion.div>
  );
}
