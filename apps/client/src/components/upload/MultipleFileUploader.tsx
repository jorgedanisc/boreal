import { useRef, useState, useEffect, useLayoutEffect } from "react";
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
  AudioLines as AudioLinesIcon, // New Icon
  //   Loader2,
  //   Check,
  //   AlertTriangle,
  FlameKindling,
} from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { motion, AnimatePresence } from "motion/react";
import { useVirtualizer } from '@tanstack/react-virtual';

// Tauri drag-drop event payload type
interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

const getFileIconByName = (name: string, _isSmall = false, className = "") => {
  const ext = name.split('.').pop()?.toLowerCase();
  const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext || '');

  if (isAudio) {
    return <AudioLinesIcon className={cn("text-muted-foreground", className)} />;
  }
  return <FileIcon className={cn("text-muted-foreground", className)} />;
};

// Type for media extensions from Rust backend
interface MediaExtensions {
  images: string[];
  videos: string[];
  audio: string[];
}

// Helper to extract frames from video using Blob URLs (cross-platform)
const extractFramesFromVideo = async (path: string): Promise<string[]> => {
  try {
    // Dynamic import to avoid SSR issues
    const { readFile } = await import('@tauri-apps/plugin-fs');

    // 1. Read file as binary
    const bytes = await readFile(path);

    // 2. Determine MIME type from extension
    const ext = path.split('.').pop()?.toLowerCase() || 'mp4';
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
    };
    const mimeType = mimeTypes[ext] || 'video/mp4';

    // 3. Create Blob and Object URL
    const blob = new Blob([bytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    // 4. Extract frames
    const frames = await extractFramesFromBlobUrl(blobUrl);

    // 5. Cleanup
    URL.revokeObjectURL(blobUrl);

    return frames;
  } catch (err) {
    console.error("[ExtractFrames] Failed to extract frames:", err);
    return [];
  }
};

// Extract frames from a blob URL using canvas (optimized)
const extractFramesFromBlobUrl = (blobUrl: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = blobUrl;
    video.muted = true;
    video.playsInline = true; // Important for mobile
    video.preload = 'metadata';
    // Append to body but hidden - ensures rendering triggers on some WebViews
    video.style.position = 'absolute';
    video.style.opacity = '0';
    video.style.top = '-9999px';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    const frames: string[] = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const cleanup = () => {
      if (document.body.contains(video)) {
        document.body.removeChild(video);
      }
      URL.revokeObjectURL(blobUrl);
    };

    if (!ctx) {
      cleanup();
      resolve([]);
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve(frames);
    }, 15000); // Increased timeout for slower devices

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (!duration || duration === Infinity || isNaN(duration)) {
        cleanup();
        clearTimeout(timeout);
        resolve([]);
        return;
      }

      const count = 6;
      const interval = duration / count;

      try {
        // Start at 0.5s or 5% to avoid intro black frames
        const startOffset = Math.min(0.5, duration * 0.05);

        for (let i = 0; i < count; i++) {
          const seekTime = Math.min(startOffset + (i * interval), duration - 0.1);
          video.currentTime = seekTime;

          await new Promise<void>((r) => {
            const seekHandler = () => {
              video.removeEventListener('seeked', seekHandler);
              // Small delay to ensure frame is actually rendered in buffer
              setTimeout(r, 150);
            };
            video.addEventListener('seeked', seekHandler);
          });

          // Use original video dimensions (no resizing)
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          // Draw full resolution frame
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert to base64 JPEG with decent quality (0.8)
          // Note: Full res frames -> large payload. 
          // Backend handles final resize/compression for animated thumbnail.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          frames.push(dataUrl.split(',')[1]);
        }
      } catch (e) {
        console.error("[ExtractFrames] Error:", e);
      }

      clearTimeout(timeout);
      cleanup();
      resolve(frames);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve([]);
    };
  });
};

const isVideoFile = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext || '');
}

const isImageFile = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff'].includes(ext || '');
}

// Component to handle async image loading from local FS via Blob URL
// This bypasses asset:// protocol issues by using the same method as video frames
const ImagePreview = ({ path }: { path: string }) => {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(path);
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        if (active) setSrc(url);
        return () => URL.revokeObjectURL(url);
      } catch (e) {
        console.error("Failed to load image preview", path, e);
      }
    };
    const cleanup = load();
    return () => { active = false; cleanup.then(c => c?.()); };
  }, [path]);

  if (!src) return <div className="w-full h-full bg-muted animate-pulse" />;

  return (
    <img
      src={src}
      className="w-full h-full object-cover rounded-sm"
      alt="preview"
    />
  );
};

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
    clearPending,
    getPendingCount,
    getOverallProgress,
    getTotalSize,
    getTotalBytesUploaded,
    initializeListeners,
    freshUploadEnabled,
    setFreshUpload,
  } = useUploadStore();

  const filesToRender = [...files].sort((a, b) => b.size - a.size); // Sort by size descending
  const [parentRef, setParentRef] = useState<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: filesToRender.length,
    getScrollElement: () => parentRef,
    estimateSize: () => 72, // Approximate height of each row item
    overscan: 20,
  });

  // Force measure update when drawer opens or files change to fix blank list issue
  useEffect(() => {
    if (!isMinimized && parentRef) {
      // Small delay to wait for drawer animation to complete and DOM to be ready
      const timeoutId = setTimeout(() => {
        rowVirtualizer.measure();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isMinimized, filesToRender.length, rowVirtualizer, parentRef]);

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
          // Process thumbnails for dropped video files
          const thumbnails: Record<string, string[]> = {};

          await Promise.all(paths.map(async (p) => {
            if (isVideoFile(p)) {
              toast.loading("generating thumbnail...");
              const frames = await extractFramesFromVideo(p);
              console.log('[Thumbnail Debug] Extracted frames for', p, ':', frames.length, 'frames');
              if (frames.length > 0) {
                thumbnails[p] = frames;
              }
              toast.dismiss();
            }
          }));

          console.log('[Thumbnail Debug] thumbnails map:', Object.keys(thumbnails));
          await addFiles(paths, thumbnails);
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
        // @ts-ignore
        const pathList: string[] = Array.isArray(selected) ? selected : [selected];

        // Extract frames
        const thumbnails: Record<string, string[]> = {};
        // Run in parallel but only for a few items to avoid UI freeze? 
        // For mobile selection usually small number. 
        // For desktop mass select, this might take time.
        // Let's limit concurrency if needed, but for now simple Promise.all
        // Only checking explicit video extensions to avoid overhead

        const videoPaths = pathList.filter(isVideoFile);
        if (videoPaths.length > 0) {
          toast.message("Processing video thumbnails...");
          await Promise.all(videoPaths.map(async (p) => {
            const frames = await extractFramesFromVideo(p);
            if (frames.length > 0) {
              thumbnails[p] = frames;
            }
          }));
        }

        await addFiles(pathList, thumbnails);
        toast.success(`Added ${pathList.length} files`);
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
    // 2. Clear pending efficiently
    clearPending();
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
      {/* Trigger Button (FAB) removed as per request */}
      {/* {isMinimized && (files.length > 0 || isProcessing) && (
        <Button ... />
      )} */}

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerContent className="h-[65%] max-w-xl w-[calc(100%-16px)] mx-auto flex flex-col bg-background/80 backdrop-blur-2xl border border-white/10 shadow-2xl">
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
                  {/* Virtualized List Container with Scroll Mask */}
                  <div
                    key={isOpen ? 'open' : 'closed'}
                    ref={setParentRef}
                    className="h-full w-full overflow-y-auto relative mask-linear-fade py-4"
                    style={{
                      maskImage: 'linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)',
                      WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)'
                    }}
                  >
                    <div
                      style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const file = filesToRender[virtualRow.index];
                        const progress = getProgressValue(file);
                        const isCompleted = file.status === 'Completed';
                        const isFailed = typeof file.status === 'object' && 'Failed' in file.status;

                        return (
                          <div
                            key={file.id}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="p-1"
                          >
                            <div
                              className={cn(
                                "flex flex-col w-full gap-1 rounded-lg border-2 p-1.5 pe-3 transition-all duration-300 h-[68px]",
                                isCompleted ? "border-green-500/50 bg-green-500/5" : "border-border bg-background",
                                isFailed && "border-destructive/50 bg-destructive/5"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                                  <div className="relative flex aspect-square size-10 shrink-0 items-center justify-center rounded-md border-2 overflow-hidden bg-background">
                                    {file.pre_generated_frames?.[0] ? (
                                      <img
                                        src={`data:image/jpeg;base64,${file.pre_generated_frames[0]}`}
                                        className="w-full h-full object-cover rounded-sm"
                                        alt="preview"
                                      />
                                    ) : isImageFile(file.path) ? (
                                      <ImagePreview path={file.path} />
                                    ) : (
                                      getFileIconByName(file.filename, false, "size-5")
                                    )}
                                  </div>
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="text-sm font-medium truncate w-full block" title={file.filename}>
                                      {file.filename}
                                    </span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {formatBytes(file.size)}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="flex flex-col items-end min-w-[60px]">
                                    {/* Only show status text if Failed or uploading */}
                                    <span className={cn(
                                      "text-xs font-medium",
                                      isFailed && "text-destructive"
                                    )}>
                                      {isProcessing && file.status !== 'Completed' && !isFailed ? `${Math.round(progress)}%` :
                                        isFailed ? 'Failed' : ''}
                                    </span>
                                  </div>
                                  {!isProcessing && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={() => removeFile(file.id)}
                                    >
                                      <XIcon className="size-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Progress bar line */}
                              {isProcessing && !isCompleted && !isFailed && (
                                <div className="h-1 w-full bg-muted rounded-full overflow-hidden mt-1">
                                  <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
