import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerFooter } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getPhotos, Photo, getThumbnail, queueManifestSync } from '@/lib/vault';
import { Check, X, Calendar as CalendarIcon, Loader2, Search, Music, PaperclipIcon, AudioLinesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';

interface CreateMemoryPayload {
  title: string;
  text_content: string;
  date: string;
  media_ids: string[];
}

interface MemoryEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

export function MemoryEditor({ open, onOpenChange, onSave }: MemoryEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);

  // Media Selection State
  const [availablePhotos, setAvailablePhotos] = useState<Photo[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Thumbnail cache for efficient loading (like MasonryGrid pattern)
  const [thumbnailCache, setThumbnailCache] = useState<Record<string, string>>({});

  const filteredPhotos = availablePhotos; // TODO: Implement search filtering

  useEffect(() => {
    if (open) {
      // Reset form when drawer opens
    }
  }, [open]);

  // Load photos and thumbnails when dialog opens
  useEffect(() => {
    if (isMediaDialogOpen && availablePhotos.length === 0) {
      loadPhotosWithThumbnails();
    }
  }, [isMediaDialogOpen]);

  const loadPhotosWithThumbnails = async () => {
    try {
      const photos = await getPhotos();
      setAvailablePhotos(photos);

      // Batch load thumbnails like MasonryGrid does (only for non-audio)
      const BATCH_SIZE = 10;
      const imageVideoPhotos = photos.filter(p => (p.media_type || 'image') !== 'audio');

      for (let i = 0; i < imageVideoPhotos.length; i += BATCH_SIZE) {
        const batch = imageVideoPhotos.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (p) => {
          if (!thumbnailCache[p.id]) {
            try {
              const b64 = await getThumbnail(p.id);
              setThumbnailCache(prev => ({ ...prev, [p.id]: b64 }));
            } catch (e) {
              console.error("Failed to load thumbnail for " + p.id, e);
            }
          }
        }));
      }
    } catch (e) {
      console.error("Failed to load photos", e);
    }
  };

  const toggleMedia = (id: string) => {
    setSelectedMediaIds(prev =>
      prev.includes(id)
        ? prev.filter(mid => mid !== id)
        : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!title) return;
    setLoading(true);
    try {
      const payload: CreateMemoryPayload = {
        title,
        text_content: content,
        date: date ? format(date, 'yyyy-MM-dd') : new Date().toISOString().split('T')[0],
        media_ids: selectedMediaIds,
      };
      await invoke('create_memory', { payload });

      // Queue manifest sync to upload changes to S3
      queueManifestSync();

      onSave();
      onOpenChange(false);

      // Reset form
      setTitle('');
      setContent('');
      setDate(new Date());
      setSelectedMediaIds([]);
    } catch (e) {
      console.error("Failed to save memory:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Main Editor - Now a Drawer (from bottom) */}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85vh] flex flex-col">
          <div className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">

            {/* Title */}
            <Input
              placeholder="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-xl! font-semibold bg-transparent border-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50 h-auto"
            />

            {/* Content */}
            <Textarea
              placeholder="What will you remember most about today? Or what memory you want to keep forever?"
              value={content}
              onChange={e => setContent(e.target.value)}
              className="flex-1 min-h-[150px] resize-none bg-transparent border-none px-0 focus-visible:ring-0 text-md! leading-relaxed"
            />

            {/* Selected Media Preview */}
            {selectedMediaIds.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Attached Media ({selectedMediaIds.length})
                </h4>
                <div className="flex gap-2 overflow-x-auto py-1 pb-2">
                  {selectedMediaIds.map(id => (
                    <div key={id} className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden group border border-white/10">
                      <MediaPreview id={id} photos={availablePhotos} thumbnailCache={thumbnailCache} />
                      <button
                        onClick={() => toggleMedia(id)}
                        className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attach Media Button */}
            <div className="flex items-center flex-row w-full gap-4 overflow-hidden">
              {/* Date Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal bg-white/5 border-white/10",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                className="border-dashed grow border-white/20 hover:bg-white/5"
                onClick={() => setIsMediaDialogOpen(true)}
              >
                <PaperclipIcon className="mr-1 h-4 w-4" />
                Attach Media
              </Button>
            </div>
          </div>

          <DrawerFooter className="border-t border-white/10 bg-muted/10 shrink-0">
            <div className="flex justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={loading || !title}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Entry
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Media Selection - Now a Dialog (centered popup) */}
      <Dialog open={isMediaDialogOpen} onOpenChange={setIsMediaDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col bg-background/95 backdrop-blur-xl border-white/10 p-0 overflow-hidden gap-0">
          <DialogHeader className="p-4 border-b border-white/10 shrink-0">
            <DialogTitle>Select Media</DialogTitle>
          </DialogHeader>

          {/* Search */}
          <div className="shrink-0 p-3 bg-background/95 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 bg-white/5 border-white/10"
              />
            </div>
          </div>

          {/* Grid with Cached Thumbnails & Audio Support */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-4 gap-2">
              {filteredPhotos.map(photo => (
                <CachedMediaItem
                  key={photo.id}
                  photo={photo}
                  thumbnail={thumbnailCache[photo.id]}
                  selected={selectedMediaIds.includes(photo.id)}
                  onToggle={() => toggleMedia(photo.id)}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 shrink-0 p-3">
            <div className="flex justify-between items-center w-full">
              <span className="text-sm text-muted-foreground">{selectedMediaIds.length} selected</span>
              <Button onClick={() => setIsMediaDialogOpen(false)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MediaPreview({ id, photos, thumbnailCache }: { id: string; photos: Photo[]; thumbnailCache: Record<string, string> }) {
  const photo = photos.find(p => p.id === id);
  const mediaType = photo?.media_type || 'image';
  const thumb = thumbnailCache[id];

  if (mediaType === 'audio') {
    return (
      <div className="w-full h-full bg-muted/30 flex items-center justify-center">
        <AudioLinesIcon className="w-6 h-6 text-primary" />
      </div>
    );
  }

  if (!thumb) return <div className="w-full h-full bg-muted animate-pulse" />;
  return <img src={`data:image/webp;base64,${thumb}`} className="w-full h-full object-cover" alt="" />;
}

/**
 * CachedMediaItem - Uses pre-loaded thumbnail from parent cache
 * Memoized to prevent unnecessary re-renders
 * Handles audio items with Music icon like MasonryGrid
 */
const CachedMediaItem = memo(function CachedMediaItem({
  photo,
  thumbnail,
  selected,
  onToggle
}: {
  photo: Photo;
  thumbnail?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const mediaType = photo.media_type || 'image';

  // Audio item rendering (like MasonryGrid)
  if (mediaType === 'audio') {
    return (
      <div
        onClick={onToggle}
        className={cn(
          "aspect-square relative cursor-pointer overflow-hidden rounded-lg transition-all border-2",
          "bg-muted/30 flex items-center justify-center",
          selected ? "border-primary ring-2 ring-primary/50" : "border-transparent hover:border-white/20"
        )}
      >
        <div className="text-center p-2">
          <div className="w-10 h-10 bg-primary/10 flex items-center justify-center mx-auto mb-1 rounded-full">
            <AudioLinesIcon className="w-5 h-5 text-primary" />
          </div>
          <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[80px] block">
            {photo.filename}
          </span>
        </div>
        {selected && (
          <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-0.5 shadow-lg">
            <Check className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    );
  }

  // Image/Video rendering
  return (
    <div
      onClick={onToggle}
      className={cn(
        "aspect-square relative cursor-pointer overflow-hidden rounded-lg transition-all border-2",
        selected ? "border-primary ring-2 ring-primary/50" : "border-transparent hover:border-white/20"
      )}
    >
      {thumbnail ? (
        <img
          src={`data:image/webp;base64,${thumbnail}`}
          className="w-full h-full object-cover"
          alt={photo.filename}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-muted animate-pulse" />
      )}
      {selected && (
        <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-0.5 shadow-lg">
          <Check className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
});
