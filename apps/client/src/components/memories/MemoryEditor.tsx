import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getPhotos, Photo, getThumbnail } from '@/lib/vault';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateMemoryPayload {
  title: string;
  text_content: string;
  date: string;
  media_ids: string[];
}

interface MemoryEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void; // Trigger refresh
}

export function MemoryEditor({ open, onOpenChange, onSave }: MemoryEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  // Media Selection State
  const [availablePhotos, setAvailablePhotos] = useState<Photo[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [isSelectingMedia, setIsSelectingMedia] = useState(false);

  useEffect(() => {
    if (open) {
      loadPhotos();
    }
  }, [open]);

  const loadPhotos = async () => {
    try {
      const photos = await getPhotos();
      setAvailablePhotos(photos);
      // Pre-fetch thumbnails for first 20 or so? 
      // For now lazy load them in item component or just batched here if we want instant grid
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

  // Helper component for grid items to handle their own thumbnail fetching
  const MediaItem = ({ photo, selected, onToggle }: { photo: Photo, selected: boolean, onToggle: () => void }) => {
    const [thumb, setThumb] = useState<string | null>(null);

    useEffect(() => {
      getThumbnail(photo.id).then(setThumb).catch(() => { });
    }, [photo.id]);

    return (
      <div
        onClick={onToggle}
        className={cn(
          "aspect-square relative cursor-pointer overflow-hidden rounded-lg transition-all",
          selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:opacity-90"
        )}
      >
        {thumb ? (
          <img src={`data:image/webp;base64,${thumb}`} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full bg-muted animate-pulse" />
        )}
        {selected && (
          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
            <Check className="w-3 h-3" />
          </div>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    if (!title) return;
    setLoading(true);
    try {
      const payload: CreateMemoryPayload = {
        title,
        text_content: content,
        date,
        media_ids: selectedMediaIds,
      };
      await invoke('create_memory', { payload });
      onSave();
      onOpenChange(false);

      // Reset form
      setTitle('');
      setContent('');
      setDate(new Date().toISOString().split('T')[0]);
      setSelectedMediaIds([]);
      setIsSelectingMedia(false);
    } catch (e) {
      console.error("Failed to save memory:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col bg-background/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <DialogTitle>New Entry</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 py-4 overflow-y-auto">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-muted-foreground">Date</label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-white/5 border-white/10"
            />
          </div>

          <div className="grid gap-2">
            <Input
              placeholder="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-lg font-bold bg-transparent border-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="grid gap-2 flex-1">
            <Textarea
              placeholder="What will you remember most about today?"
              value={content}
              onChange={e => setContent(e.target.value)}
              className="flex-1 resize-none bg-transparent border-none px-0 focus-visible:ring-0 text-base leading-relaxed p-0 min-h-[200px]"
            />
          </div>

          {/* Selected Media Preview (Horizontal Scroll) */}
          {selectedMediaIds.length > 0 && !isSelectingMedia && (
            <div className="flex gap-2 overflow-x-auto py-2">
              {selectedMediaIds.map(id => {
                const photo = availablePhotos.find(p => p.id === id);
                if (!photo) return null;
                return (
                  <div key={id} className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden group">
                    {/* Re-using logic or just fetch again - ideally cache handles it */}
                    <MediaPreview id={id} />
                    <div
                      onClick={() => toggleMedia(id)}
                      className="absolute top-1 right-1 bg-black/50 hover:bg-destructive text-white rounded-full p-0.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Media Selection Area or Trigger */}
          {isSelectingMedia ? (
            <div className="flex-1 min-h-[200px] border border-white/10 rounded-xl p-4 bg-black/20">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Select Media</span>
                <Button variant="ghost" size="sm" onClick={() => setIsSelectingMedia(false)}>Done</Button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[300px] overflow-y-auto">
                {availablePhotos.map(photo => (
                  <MediaItem
                    key={photo.id}
                    photo={photo}
                    selected={selectedMediaIds.includes(photo.id)}
                    onToggle={() => toggleMedia(photo.id)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div
              onClick={() => setIsSelectingMedia(true)}
              className="border border-dashed border-white/20 rounded-xl p-8 flex items-center justify-center text-muted-foreground hover:bg-white/5 cursor-pointer transition-colors"
            >
              <p>+ Add Photos from Vault</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || !title}>
            {loading ? 'Saving...' : 'Save Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaPreview({ id }: { id: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => { getThumbnail(id).then(setThumb).catch(() => { }) }, [id]);
  if (!thumb) return <div className="w-full h-full bg-muted animate-pulse" />;
  return <img src={`data:image/webp;base64,${thumb}`} className="w-full h-full object-cover" alt="" />;
}
