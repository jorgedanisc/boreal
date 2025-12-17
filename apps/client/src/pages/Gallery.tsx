import { useState, useEffect, useMemo } from 'react';
import { getPhotos, getThumbnail, Photo, getActiveVault, VaultPublic } from '../lib/vault';
import { ChevronLeft, Image as ImageIcon } from 'lucide-react';
import { ShareVaultDialog } from '../components/vault/ShareVaultDialog';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { MultipleFileUploader } from '@/components/upload/MultipleFileUploader';
import { UploadTrigger } from '@/components/upload/UploadTrigger';
import { useUploadStore } from '@/stores/upload_store';
import { invoke } from '@tauri-apps/api/core';

// Custom Gallery Components
import { MasonryGrid, MediaItem } from '@/components/gallery/MasonryGrid';
import { AudioPlayer } from '@/components/gallery/AudioPlayer';

// Lightbox
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

export default function Gallery() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);
  const { getCompletedCount } = useUploadStore();
  const [lastCompletedCount, setLastCompletedCount] = useState(0);

  // Lightbox State
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Audio Player State
  const [audioPlayer, setAudioPlayer] = useState<{ id: string; filename: string } | null>(null);

  // Initialize upload manager when vault is loaded
  useEffect(() => {
    if (activeVault) {
      invoke('initialize_upload_manager').catch(console.error);
    }
  }, [activeVault]);

  const loadPhotos = async () => {
    try {
      const vault = await getActiveVault();
      if (!vault) {
        navigate({ to: "/" });
        return;
      }
      setActiveVault(vault);

      const list = await getPhotos();
      setPhotos(list);

      // Load thumbnails lazily (skip audio - no thumbnails)
      const BATCH_SIZE = 10;
      const imageVideoPhotos = list.filter(p => (p.media_type || 'image') !== 'audio');

      for (let i = 0; i < imageVideoPhotos.length; i += BATCH_SIZE) {
        const batch = imageVideoPhotos.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (p) => {
          if (!thumbnails[p.id]) {
            try {
              const b64 = await getThumbnail(p.id);
              setThumbnails(prev => ({ ...prev, [p.id]: `data:image/webp;base64,${b64}` }));
            } catch (e) {
              console.error("Failed to load thumbnail for " + p.id, e);
            }
          }
        }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, []);

  // Refresh photos when uploads complete
  const completedCount = getCompletedCount();
  useEffect(() => {
    if (completedCount > lastCompletedCount) {
      loadPhotos();
      setLastCompletedCount(completedCount);
    }
  }, [completedCount, lastCompletedCount]);

  // Map photos to MediaItem format for MasonryGrid
  const mediaItems: MediaItem[] = useMemo(() => {
    return photos.map(p => {
      const mediaType = (p.media_type || 'image') as 'image' | 'video' | 'audio';
      return {
        id: p.id,
        src: thumbnails[p.id] || '',
        width: p.width > 0 ? p.width : 500,
        height: p.height > 0 ? p.height : 500,
        alt: p.filename,
        mediaType,
      };
    });
  }, [photos, thumbnails]);

  // Lightbox slides (for images/videos only)
  const slides = useMemo(() => {
    return photos
      .filter(p => (p.media_type || 'image') !== 'audio')
      .map(p => ({
        src: thumbnails[p.id] || '',
        alt: p.filename,
      }));
  }, [photos, thumbnails]);

  // Handle item click
  const handleItemClick = (index: number) => {
    const photo = photos[index];
    const mediaType = photo?.media_type || 'image';

    if (mediaType === 'audio') {
      // Open audio player
      setAudioPlayer({ id: photo.id, filename: photo.filename });
    } else {
      // Open lightbox - find index in filtered slides
      const filteredPhotos = photos.filter(p => (p.media_type || 'image') !== 'audio');
      const lightboxIdx = filteredPhotos.findIndex(p => p.id === photo.id);
      setLightboxIndex(lightboxIdx);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/" })}
            className="shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              {activeVault?.name || "Photos"}
            </h1>
            {activeVault && (
              <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                {activeVault.bucket}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeVault && <ShareVaultDialog vaultId={activeVault.id} />}
          <UploadTrigger />
        </div>
      </header>

      <main className="flex-1 p-2">
        {photos.length === 0 ? (
          <div className="h-[50vh] flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p>No photos yet</p>
            <UploadTrigger />
          </div>
        ) : (
          <MasonryGrid
            items={mediaItems}
            columns={4}
            spacing={4}
            onItemClick={handleItemClick}
          />
        )}
      </main>

      {/* Lightbox for images/videos */}
      <Lightbox
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={() => setLightboxIndex(-1)}
        slides={slides}
        plugins={[Zoom]}
      />

      {/* Audio Player Modal */}
      <AudioPlayer
        isOpen={!!audioPlayer}
        onClose={() => setAudioPlayer(null)}
        audioId={audioPlayer?.id || ''}
        filename={audioPlayer?.filename || ''}
      />

      {/* Upload Panel - Fixed at Bottom Center */}
      <MultipleFileUploader />
    </div>
  );
}