import {
  IconPhoto,
  IconVideo,
  IconMusic,
  IconFiles,
} from '@tabler/icons-react';
import { useUploadStore, formatFileSize } from '../../stores/upload_store';
import type { MediaType } from '../../stores/upload_store';

interface StatItemProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  size: number;
}

function StatItem({ icon, label, count, size }: StatItemProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{count}</span>
        <span className="text-xs text-muted-foreground">({formatFileSize(size)})</span>
      </div>
    </div>
  );
}

interface UploadStatsProps {
  showDetails?: boolean;
}

export function UploadStats({ showDetails = false }: UploadStatsProps) {
  const {
    files,
    getTotalSize,
    getTotalBytesUploaded,
    getOverallProgress,
    getCompletedCount,
    getFailedCount,
    getFilesByMediaType,
  } = useUploadStore();

  if (files.length === 0) {
    return null;
  }

  const totalSize = getTotalSize();
  const totalBytesUploaded = getTotalBytesUploaded();
  const overallProgress = getOverallProgress();
  const completedCount = getCompletedCount();
  const failedCount = getFailedCount();
  const filesByType = getFilesByMediaType();

  const calculateTypeSize = (type: MediaType) =>
    filesByType[type].reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="space-y-2">
      {/* Summary stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconFiles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{files.length} files</span>
        </div>
        <span className="text-sm text-muted-foreground">{formatFileSize(totalSize)}</span>
      </div>

      {/* Overall progress */}
      {totalBytesUploaded > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatFileSize(totalBytesUploaded)} uploaded</span>
            <span>{Math.round(overallProgress * 100)}%</span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${overallProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Status summary */}
      <div className="flex items-center gap-3 text-xs">
        {completedCount > 0 && (
          <span className="text-green-500">{completedCount} done</span>
        )}
        {failedCount > 0 && (
          <span className="text-destructive">{failedCount} failed</span>
        )}
      </div>

      {/* Breakdown by type (optional) */}
      {showDetails && (
        <div className="pt-2 border-t border-border space-y-1">
          <StatItem
            icon={<IconPhoto className="h-4 w-4 text-blue-500" />}
            label="Images"
            count={filesByType.Image.length}
            size={calculateTypeSize('Image')}
          />
          <StatItem
            icon={<IconVideo className="h-4 w-4 text-purple-500" />}
            label="Videos"
            count={filesByType.Video.length}
            size={calculateTypeSize('Video')}
          />
          <StatItem
            icon={<IconMusic className="h-4 w-4 text-green-500" />}
            label="Audio"
            count={filesByType.Audio.length}
            size={calculateTypeSize('Audio')}
          />
        </div>
      )}
    </div>
  );
}
