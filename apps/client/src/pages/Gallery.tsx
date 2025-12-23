import { UploadTrigger } from '@/components/upload/UploadTrigger';
import { RenameVaultDialog } from '@/components/vault/RenameVaultDialog';
import { useUploadStore } from '@/stores/upload_store';
import { invoke } from '@tauri-apps/api/core';
import { Image as ImageIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getActiveVault, getPhotos, getThumbnail, Photo, renameVault, VaultPublic } from '../lib/vault';
import { useGalleryLayout } from '@/routes/gallery';

// Custom Gallery Components
import { AudioPlayer } from '@/components/gallery/AudioPlayer';
import { VirtualizedMasonryGrid, MediaItem, LayoutItem } from '@/components/gallery/MasonryGrid';
import { GlobalPhotoSlider, PhotoMetadata } from '@/components/gallery/PhotoLightbox';
import 'react-photo-view/dist/react-photo-view.css';
import { type } from '@tauri-apps/plugin-os';

export default function Gallery() {
  const { setSubtitle } = useGalleryLayout();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);
  const { getCompletedCount } = useUploadStore();
  const [lastCompletedCount, setLastCompletedCount] = useState(0);

  // View Mode State
  //   const [viewMode, setViewMode] = useState<'memories' | 'library' | 'map'>('library');

  // Lightbox State
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Audio Player State
  const [audioPlayer, setAudioPlayer] = useState<{ id: string; filename: string } | null>(null);

  // Rename State
  const [renameOpen, setRenameOpen] = useState(false);

  const [isDesktop, setIsDesktop] = useState(false);

  // Scroll & Layout State
  const [currentScrollY, setCurrentScrollY] = useState(0);
  const [itemOffsets, setItemOffsets] = useState<number[]>([]);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

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
        // No vault loaded, could redirect but layout handles that
        setIsLoading(false);
        return;
      }
      setActiveVault(vault);

      const list = await getPhotos();
      setPhotos(list);

      // Load thumbnails
      const BATCH_SIZE = 10;
      const imageVideoPhotos = list.filter(p => (p.media_type || 'image') !== 'audio');

      for (let i = 0; i < imageVideoPhotos.length; i += BATCH_SIZE) {
        const batch = imageVideoPhotos.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (p) => {
          if (!thumbnails[p.id]) {
            // Retry logic for thumbnails (videos might take a moment to be available)
            let retries = 3;
            while (retries > 0) {
              try {
                const b64 = await getThumbnail(p.id);
                if (b64) {
                  setThumbnails(prev => ({ ...prev, [p.id]: `data:image/webp;base64,${b64}` }));
                  break;
                }
              } catch (e) {
                console.error(`Failed to load thumbnail for ${p.id} (attempts left: ${retries})`, e);
              }
              retries--;
              if (retries > 0) await new Promise(r => setTimeout(r, 1000));
            }
          }
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
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

  // Media Items
  const mediaItems: MediaItem[] = useMemo(() => {
    return photos.map(p => {
      const mediaType = (p.media_type || 'image') as 'image' | 'video' | 'audio';
      return {
        id: p.id,
        src: thumbnails[p.id] || '',
        width: p.width,
        height: p.height,
        alt: p.filename,
        mediaType,
        capturedAt: p.captured_at || p.created_at,
      };
    });
  }, [photos, thumbnails]);

  // Date Grouping
  // const timelineDates = useMemo(() => {


  // Handle Scroll to update active date
  useEffect(() => {
    if (photos.length === 0) {
      setSubtitle('Timeline');
      return;
    }

    // Find the photo that is currently in view based on scroll position
    // Get the index of the photo closest to the current scroll position
    let closestIndex = 0;
    let minDistance = Infinity;
    for (let i = 0; i < itemOffsets.length; i++) {
      const distance = Math.abs(itemOffsets[i] - currentScrollY);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    // Format date as "21 Dec 2025"
    const photo = photos[closestIndex];
    const dateStr = photo?.captured_at || photo?.created_at;
    if (dateStr) {
      try {
        const date = new Date(dateStr);
        const formatted = date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        setSubtitle(formatted);
      } catch {
        setSubtitle('Timeline');
      }
    }
  }, [currentScrollY, photos, itemOffsets, setSubtitle]);

  // Handle Layout Computation from MasonryGrid
  const handleLayoutComputed = useCallback((layout: LayoutItem[]) => {
    const offsets = new Array(layout.length).fill(0);
    layout.forEach(item => {
      offsets[item.globalIndex] = item.y;
    });
    setItemOffsets(offsets);
  }, []);

  const handleScrollPositionChange = useCallback((offsetY: number, _totalHeight: number) => {
    setCurrentScrollY(offsetY);
  }, []);

  // Slides for lightbox
  const lightboxPhotos = useMemo(() => {
    return photos
      .filter(p => (p.media_type || 'image') !== 'audio')
      .map(p => ({
        id: p.id,
        filename: p.filename,
        captured_at: p.captured_at,
        created_at: p.created_at,
        latitude: p.latitude,
        longitude: p.longitude,
        width: p.width,
        height: p.height,
        vault_id: activeVault?.id
      }));
  }, [photos, activeVault]);

  const handleItemClick = (index: number) => {
    const photo = photos[index];
    const mediaType = photo?.media_type || 'image';

    if (mediaType === 'audio') {
      setAudioPlayer({ id: photo.id, filename: photo.filename });
    } else {
      const filteredPhotos = photos.filter(p => (p.media_type || 'image') !== 'audio');
      const lightboxIdx = filteredPhotos.findIndex(p => p.id === photo.id);
      setLightboxIndex(lightboxIdx);
    }
  };

  // Grid spacing constant for consistent padding
  const GRID_SPACING = 5;

  return (
    <>
      {/* Main Content - grid fills entire screen */}
      <main className="absolute inset-0">
        {!isLoading && photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <p>No photos yet</p>
            <UploadTrigger />
          </div>
        ) : (
          <VirtualizedMasonryGrid
            items={mediaItems}
            columns={4}
            spacing={GRID_SPACING}
            paddingTop={isDesktop ? 120 : "calc(120px + env(safe-area-inset-top))"}
            paddingBottom="calc(100px + env(safe-area-inset-bottom))"
            onItemClick={handleItemClick}
            onScrollPositionChange={handleScrollPositionChange}
            onLayoutComputed={handleLayoutComputed}
          />
        )}
      </main>

      {/* PhotoSlider for lightbox */}
      {/* PhotoSlider for lightbox */}
      <GlobalPhotoSlider
        photos={lightboxPhotos as unknown as PhotoMetadata[]}
        thumbnails={thumbnails}
        visible={lightboxIndex >= 0}
        onClose={() => setLightboxIndex(-1)}
        index={lightboxIndex >= 0 ? lightboxIndex : 0}
        onIndexChange={setLightboxIndex}
        onPhotoUpdate={(id, updates) => {
          setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
        }}
      />

      <AudioPlayer
        isOpen={!!audioPlayer}
        onClose={() => setAudioPlayer(null)}
        audioId={audioPlayer?.id || ''}
        filename={audioPlayer?.filename || ''}
      />

      <RenameVaultDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        vaultName={activeVault?.name || ""}
        onConfirm={async (newName) => {
          if (activeVault) {
            await renameVault(activeVault.id, newName);
            setActiveVault(prev => prev ? { ...prev, name: newName } : null);
          }
        }}
      />
    </>
  );

}