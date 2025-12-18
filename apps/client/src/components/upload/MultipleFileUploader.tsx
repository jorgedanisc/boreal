import { useRef, useState, useEffect } from "react";
import { useUploadStore } from "@/stores/upload_store";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Folder as FolderIcon,
  Upload as UploadIcon,
  X as XIcon,
  File as FileIcon,
  Loader2,
  Check,
  AlertTriangle,
  FlameKindling,
} from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { motion, AnimatePresence } from "motion/react";

// Tauri drag-drop event payload type
interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

const getFileIconByName = (_name: string, _isSmall = false, className = "") => {
  return <FileIcon className={cn("text-muted-foreground", className)} />;
};

// Type for media extensions from Rust backend
interface MediaExtensions {
  images: string[];
  videos: string[];
  audio: string[];
}

export function MultipleFileUploader() {
  const {
    files,
    addFiles,
    startUpload,
    isProcessing,
    isMinimized,
    toggleMinimized,
    removeFile,
    clearFinished,
    getPendingCount,
    getActiveCount,
    getFailedCount,
    // getCompletedCount,
    // toggleFreshUpload,
    getOverallProgress,
    getTotalSize,
    getTotalBytesUploaded,
    initializeListeners,
    freshUploadEnabled,
    // toggleFreshUpload,
    setFreshUpload,
  } = useUploadStore();

  const filesToRender = [...files].sort((a, b) => b.size - a.size); // Sort by size descending

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initializeListeners().then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      cleanup?.();
    };
  }, [initializeListeners]);

  // Local state for dragging visual
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const lastDropRef = useRef<number>(0); // Debounce rapid drop events

  // Media file extensions fetched from Rust backend
  const [mediaFilters, setMediaFilters] = useState<{ name: string; extensions: string[] }[] | null>(null);

  // Fetch supported extensions from Rust on mount
  useEffect(() => {
    invoke<MediaExtensions>('get_supported_extensions')
      .then((exts) => {
        // Combine all extensions into one filter
        const allExtensions = [...exts.images, ...exts.videos, ...exts.audio];
        setMediaFilters([{ name: 'Media Files', extensions: allExtensions }]);
      })
      .catch((err) => {
        console.error('Failed to fetch supported extensions:', err);
      });
  }, []);

  // Tauri native drag-drop event listeners
  useEffect(() => {
    let unlistenDrop: UnlistenFn | undefined;
    let unlistenEnter: UnlistenFn | undefined;
    let unlistenLeave: UnlistenFn | undefined;

    const setupListeners = async () => {
      // Listen for drag enter
      unlistenEnter = await listen<DragDropPayload>('tauri://drag-enter', (_event) => {
        if (!isProcessing) {
          setIsDragging(true);
        }
      });

      // Listen for drag leave
      unlistenLeave = await listen('tauri://drag-leave', () => {
        setIsDragging(false);
      });

      // Listen for drop
      unlistenDrop = await listen<DragDropPayload>('tauri://drag-drop', async (event) => {
        setIsDragging(false);

        if (isProcessing) {
          toast.error("Cannot add files while uploading");
          return;
        }

        // Debounce rapid drop events (prevent duplicates)
        const now = Date.now();
        if (now - lastDropRef.current < 500) {
          return; // Ignore if less than 500ms since last drop
        }
        lastDropRef.current = now;

        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          await addFiles(paths);
          toast.success(`Added ${paths.length} item${paths.length > 1 ? 's' : ''}`);
        }
      });
    };

    setupListeners();

    return () => {
      unlistenDrop?.();
      unlistenEnter?.();
      unlistenLeave?.();
    };
  }, [isProcessing, addFiles]);

  // Drawer control
  const isOpen = !isMinimized;
  const setIsOpen = (open: boolean) => {
    if (!open && !isMinimized) toggleMinimized();
    if (open && isMinimized) toggleMinimized();
  };

  // Listen for external requests to open the drawer (from UploadTrigger)
  useEffect(() => {
    const handleOpenDrawer = () => {
      setIsOpen(true);
    };
    window.addEventListener('open-upload-drawer', handleOpenDrawer);
    return () => {
      window.removeEventListener('open-upload-drawer', handleOpenDrawer);
    };
  }, [isMinimized, toggleMinimized]);

  // const fileInputRef = useRef<HTMLInputElement>(null);
  // const maxFiles = 250;

  // Derived state from store

  // Handle native file dialog via Tauri
  const handleAddFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: mediaFilters ?? undefined,
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        // @ts-ignore - paths matches store expectation
        await addFiles(paths);
        toast.success(`Added ${paths.length} files`);
      }
    } catch (err) {
      console.error("Failed to open file dialog", err);
      toast.error("Failed to open file dialog");
    }
  };

  // Handle folder add via Tauri
  const handleAddFolder = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: true,
        recursive: true,
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const result = await addFiles(paths);
        if (result.autoDisabled) {
          toast.info("Auto-upload disabled for folder import");
        } else {
          toast.success("Folder added");
        }
      }
    } catch (err) {
      console.error("Failed to open folder dialog", err);
      toast.error("Failed to open folder dialog");
    }
  };

  const handleStartUpload = async () => {
    try {
      await startUpload();
    } catch (err) {
      console.error("Upload failed to start", err);
    }
  };

  const handleClear = async () => {
    // 1. Clear finished using store action
    await clearFinished();

    // 2. Clear pending manually? 
    // The snippet says "clearing pending files... clearing them out".
    // We iterate files and remove them if they are not Processing.
    files.forEach(f => {
      // If status is not active (i.e. not currently uploading)
      if (f.status === 'Pending' || f.status === 'Failed' || (typeof f.status === 'object' && 'Failed' in f.status)) {
        removeFile(f.id);
      }
    });
  };

  // Helpers
  const getProgressValue = (file: any) => {
    // If completed, 100
    if (typeof file.status === 'string' && file.status === 'Completed') return 100;
    if (file.progress !== undefined) return file.progress;
    return 0;
  };

  const getStatusLabel = (status: any) => {
    if (typeof status === 'string') return status;
    if (status.UploadingOriginal) return `${Math.round(status.UploadingOriginal.progress * 100)}%`;
    if (status.UploadingThumbnail) return `Thumb...`;
    if ('Failed' in status) return 'Failed';
    return 'Pending';
  };

  // Calculate stats for UI
  const overallProgress = getOverallProgress();
  const bytesUploaded = getTotalBytesUploaded();
  const totalSizeBytes = getTotalSize();

  return (
    <>
      {/* Trigger Button (FAB) */}
      {isMinimized && (files.length > 0 || isProcessing) && (
        <Button
          variant="outline"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full shadow-lg gap-2 pl-3 pr-4 h-10 border-border/50 bg-background/80 backdrop-blur-md hover:bg-muted/80"
          onClick={() => setIsOpen(true)}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : getFailedCount() > 0 ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <Check className="h-4 w-4 text-green-500" />
          )}

          <span className="text-sm font-medium">
            {isProcessing || getActiveCount() > 0 ? (
              `Uploading ${getActiveCount()}...`
            ) : getFailedCount() > 0 ? (
              `${getFailedCount()} failed`
            ) : (
              "Uploads Ready"
            )}
          </span>

          {isProcessing && (
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden ml-2">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${overallProgress * 100}%` }}
              />
            </div>
          )}
        </Button>
      )}

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerContent className="h-[65%] max-w-xl w-[calc(100%-16px)] mx-auto flex flex-col">
          <DrawerHeader className="px-6 pb-2 flex-none flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DrawerTitle className="text-left">Upload Files</DrawerTitle>
                {/* File count & size - only when NOT uploading */}
                <AnimatePresence mode="wait">
                  {!isProcessing && files.length > 0 && (
                    <motion.span
                      key="file-stats"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full"
                    >
                      {files.length} file{files.length !== 1 ? 's' : ''} · {formatBytes(totalSizeBytes)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {/* Fresh Upload Toggle */}
              <div className="flex items-center gap-2 pl-4 ml-2">
                <Switch
                  id="fresh-upload-toggle"
                  checked={freshUploadEnabled}
                  onCheckedChange={setFreshUpload}
                  disabled={isProcessing}
                />
                <Label htmlFor="fresh-upload-toggle" className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                  <FlameKindling className={cn("size-3.5", freshUploadEnabled ? "text-orange-500" : "text-muted-foreground")} />
                  Fresh Upload
                </Label>
              </div>
            </div>
          </DrawerHeader>

          <div
            ref={dropZoneRef}
            data-dragging={isDragging || undefined}
            data-files={files.length > 0 || undefined}
            className={cn(
              `relative flex min-h-0 grow m-4 flex-col items-center overflow-hidden rounded-xl border-2 border-dashed p-4 transition-all not-data-files:justify-center has-[input:focus]:border-ring has-[input:focus]:ring-[3px] has-[input:focus]:ring-ring/50`,
              isDragging
                ? "border-primary/60 bg-primary/5"
                : "border-input bg-card"
            )}
          >
            {files.length > 0 ? (
              <div className="flex flex-col grow w-full min-h-0 gap-3">
                {/* Header area - shows progress bar during upload, or files label when not */}
                <div className="flex flex-none items-center justify-between gap-2">
                  <AnimatePresence mode="wait">
                    {isProcessing ? (
                      <motion.div
                        key="progress-bar"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="flex-1 flex flex-col gap-1"
                      >
                        <Progress value={overallProgress * 100} className="h-2" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{Math.round(overallProgress * 100)}%</span>
                          <span>{formatBytes(bytesUploaded)} / {formatBytes(totalSizeBytes)}</span>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.h3
                        key="files-label"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="truncate text-sm font-medium"
                      >
                        Files ({files.length})
                      </motion.h3>
                    )}
                  </AnimatePresence>

                  {/* Add folder/files buttons - only when NOT uploading */}
                  <AnimatePresence>
                    {!isProcessing && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className="flex gap-2"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAddFolder}
                        >
                          <FolderIcon
                            className="-ms-0.5 mr-2 size-3.5 opacity-60"
                            aria-hidden="true"
                          />
                          Add folder
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAddFiles}
                        >
                          <UploadIcon
                            className="-ms-0.5 mr-2 size-3.5 opacity-60"
                            aria-hidden="true"
                          />
                          Add files
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div
                  className={cn(
                    "flex-1 min-h-0 w-full relative",
                  )}
                >
                  <ScrollArea className="h-full w-full">
                    <div className="flex flex-col gap-2 py-5">
                      {filesToRender.map((file) => {
                        const progress = getProgressValue(file);
                        const statusLabel = getStatusLabel(file.status);

                        return (
                          <div
                            key={file.id}
                            className="flex flex-col w-full gap-1 rounded-lg border-2 bg-background p-1.5 pe-3 transition-opacity duration-300"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 overflow-hidden">
                                <div className="flex aspect-square p-1 size-10 shrink-0 items-center justify-center rounded-md border-2">
                                  {getFileIconByName(file.filename, false, "size-5")}
                                </div>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <p className="truncate text-[13px] font-medium" title={file.path}>
                                    {file.filename}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatBytes(file.size)}
                                  </p>
                                </div>
                              </div>
                              {!isProcessing && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="-me-2 size-8 text-muted-foreground/80 hover:bg-transparent hover:text-foreground"
                                  onClick={() => removeFile(file.id)}
                                  aria-label="Remove file"
                                >
                                  <XIcon className="size-4" aria-hidden="true" />
                                </Button>
                              )}
                            </div>

                            {(isProcessing || file.bytesUploaded > 0) && (
                              <div className="mt-1 flex flex-col gap-1">
                                <Progress value={progress} />
                                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                                  <span>{statusLabel}</span>
                                  <span>{formatBytes(file.bytesUploaded || 0)} / {formatBytes(file.size)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                      }
                    </div>
                  </ScrollArea>
                </div>

                {/* Upload button area */}
                <div className="flex flex-none gap-2 place-content-between">
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    disabled={isProcessing}
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={handleStartUpload}
                    disabled={isProcessing || getPendingCount() === 0}
                    className="min-w-24"
                  >
                    {isProcessing
                      ? "Uploading..."
                      : `Upload ${getPendingCount()} File${getPendingCount() !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center h-full">
                {/* Empty State */}
                <p className="mb-1.5 text-sm font-medium">
                  Drop your files or folders here
                </p>
                <p className="text-xs text-muted-foreground">
                  No limits
                </p>
                <div className="flex gap-2 mt-8">
                  <Button
                    variant="outline"
                    onClick={handleAddFolder}
                  >
                    <FolderIcon
                      className="size-4 -ms-1 opacity-60"
                      aria-hidden="true"
                    />
                    Select folder
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleAddFiles}
                  >
                    <UploadIcon
                      className="size-4 -ms-1 opacity-60"
                      aria-hidden="true"
                    />
                    Select files
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
