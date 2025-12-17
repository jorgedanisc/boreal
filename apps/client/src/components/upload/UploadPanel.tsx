import { useEffect } from 'react';
import {
  IconChevronDown,
  IconUpload,
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconLoader2
} from '@tabler/icons-react';
import { useUploadStore, formatFileSize } from '../../stores/upload_store';
import { UploadItem } from './UploadItem';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'motion/react';

export function UploadPanel() {
  const {
    files,
    isMinimized,
    isProcessing,
    toggleMinimized,
    clearFinished,
    startUpload,
    getFilesSortedBySize,
    getTotalSize,
    getTotalBytesUploaded,
    getOverallProgress,
    getCompletedCount,
    getPendingCount,
    getFailedCount,
    getActiveCount,
    initializeListeners,
  } = useUploadStore();

  // Initialize event listeners
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initializeListeners().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, [initializeListeners]);

  // Don't render if no files
  if (files.length === 0) {
    return null;
  }

  const sortedFiles = getFilesSortedBySize();
  const totalSize = getTotalSize();
  const totalBytesUploaded = getTotalBytesUploaded();
  const overallProgress = getOverallProgress();
  const completedCount = getCompletedCount();
  const pendingCount = getPendingCount();
  const failedCount = getFailedCount();
  const activeCount = getActiveCount();
  const totalCount = files.length;
  const hasFinished = completedCount > 0 || failedCount > 0;
  const allDone = pendingCount === 0 && activeCount === 0 && !isProcessing;

  return (
    <AnimatePresence mode="wait">
      {isMinimized ? (
        <motion.div
          key="minimized"
          initial={{ opacity: 0, y: 50, x: "-50%", scale: 0.9 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          exit={{ opacity: 0, y: 50, x: "-50%", scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed bottom-6 left-1/2 z-50 origin-bottom"
          style={{ x: "-50%" }} // Force center alignment despite interactions
        >
          <Button
            variant="outline"
            className="rounded-full shadow-lg gap-2 pl-3 pr-4 h-10 border-border/50 bg-background/80 backdrop-blur-md hover:bg-muted/80"
            onClick={toggleMinimized}
          >
            {isProcessing || activeCount > 0 ? (
              <IconLoader2 className="h-4 w-4 animate-spin text-primary" />
            ) : failedCount > 0 ? (
              <IconAlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <IconCheck className="h-4 w-4 text-green-500" />
            )}

            <span className="text-sm font-medium">
              {isProcessing || activeCount > 0 ? (
                `Uploading ${activeCount} file${activeCount !== 1 ? 's' : ''}...`
              ) : failedCount > 0 ? (
                `${failedCount} failed`
              ) : pendingCount > 0 ? (
                "Ready to Upload"
              ) : (
                "Uploads Completed"
              )}
            </span>

            {/* Progress Ring or simple bar if active */}
            {(isProcessing || activeCount > 0) && (
              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden ml-2">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${overallProgress * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </Button>
        </motion.div>
      ) : (
        <motion.div
          key="expanded"
          initial={{ opacity: 0, y: 50, x: "-50%", scale: 0.95 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          exit={{ opacity: 0, y: 50, x: "-50%", scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed bottom-6 left-1/2 z-50 w-[400px] origin-bottom"
          style={{ x: "-50%" }}
        >
          <Card className="shadow-2xl flex flex-col max-h-[500px] ring-1 ring-border/50">
            {/* Header */}
            <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between space-y-0 bg-muted/30">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Uploads</h3>
                <Badge variant="secondary" className="text-xs px-1.5 h-5">
                  {completedCount}/{totalCount}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                {hasFinished && allDone && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearFinished} title="Clear finished">
                    <IconX className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleMinimized} title="Minimize">
                  <IconChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>

            <Separator />

            {/* Content List */}
            <CardContent className="p-0 flex-1 min-h-0 relative">
              <ScrollArea className="h-[300px] w-full">
                <div className="p-1 gap-1 flex flex-col">
                  <AnimatePresence initial={false}>
                    {sortedFiles.map(file => (
                      <UploadItem key={file.id} file={file} />
                    ))}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            </CardContent>

            <Separator />

            {/* Footer / Actions */}
            <CardFooter className="p-3 pt-2 bg-muted/30 flex flex-col gap-2">
              {/* Overall Progress */}
              {(isProcessing || activeCount > 0) && (
                <div className="w-full space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatFileSize(totalBytesUploaded)} / {formatFileSize(totalSize)}</span>
                    <span>{Math.round(overallProgress * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${overallProgress * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              )}

              {/* Start Button */}
              {pendingCount > 0 && !isProcessing && activeCount === 0 && (
                <Button onClick={startUpload} className="w-full h-8 text-sm" size="sm">
                  <IconUpload className="h-3.5 w-3.5 mr-2" />
                  Start Upload ({pendingCount} files)
                </Button>
              )}

              {/* Done State */}
              {allDone && totalCount > 0 && (
                <div className="w-full text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5 py-1">
                  {failedCount > 0 ? (
                    <span className="text-destructive flex items-center gap-1">
                      <IconAlertTriangle className="h-3 w-3" />
                      {failedCount} failed
                    </span>
                  ) : (
                    <span className="text-green-500 flex items-center gap-1">
                      <IconCheck className="h-3 w-3" />
                      All uploads completed
                    </span>
                  )}
                </div>
              )}
            </CardFooter>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
