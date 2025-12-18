import { Button } from '@/components/ui/button';
import { MultipleFileUploader } from '@/components/upload/MultipleFileUploader';
import { UploadTrigger } from '@/components/upload/UploadTrigger';
import { RenameVaultDialog } from '@/components/vault/RenameVaultDialog';
import { useUploadStore } from '@/stores/upload_store';
import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, Image as ImageIcon, Sparkles, Map as MapIcon, Upload as UploadIcon, Share as ShareIcon, TextCursorInputIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShareVaultDialog } from '../components/vault/ShareVaultDialog';
import { getActiveVault, getPhotos, getThumbnail, Photo, renameVault, VaultPublic } from '../lib/vault';

// Custom Gallery Components
import { AudioPlayer } from '@/components/gallery/AudioPlayer';
import { VirtualizedMasonryGrid, MediaItem, LayoutItem } from '@/components/gallery/MasonryGrid';
import { groupPhotosByDate } from '@/components/gallery/TimelineScrubber';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

// Lightbox
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { type } from '@tauri-apps/plugin-os';

export default function Gallery() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);
  const { getCompletedCount } = useUploadStore();
  const [lastCompletedCount, setLastCompletedCount] = useState(0);

  // View Mode State
  const [viewMode, setViewMode] = useState<'memories' | 'library' | 'map'>('library');

  // Lightbox State
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Audio Player State
  const [audioPlayer, setAudioPlayer] = useState<{ id: string; filename: string } | null>(null);

  // Rename State
  const [renameOpen, setRenameOpen] = useState(false);

  const [isDesktop, setIsDesktop] = useState(false);

  // Scroll & Layout State
  const [currentScrollY, setCurrentScrollY] = useState(0);
  const [totalGridHeight, setTotalGridHeight] = useState(0);
  const [itemOffsets, setItemOffsets] = useState<number[]>([]);
  const [activeDateLabel, setActiveDateLabel] = useState<string>('');

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
        navigate({ to: "/" });
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
  const timelineDates = useMemo(() => {
    const photosWithDates = photos.map(p => ({
      capturedAt: p.captured_at,
      createdAt: p.created_at,
    }));

    const getItemOffset = (index: number) => {
      // Use the computed layout offset if available, otherwise a rough estimate
      return itemOffsets[index] || index * 200;
    };

    return groupPhotosByDate(photosWithDates, getItemOffset);
  }, [photos, itemOffsets]);

  // Handle Scroll to update active date
  useEffect(() => {
    if (photos.length === 0) {
      setActiveDateLabel('');
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
        setActiveDateLabel(formatted);
      } catch {
        setActiveDateLabel('');
      }
    }
  }, [currentScrollY, photos, itemOffsets]);

  // Handle Layout Computation from MasonryGrid
  const handleLayoutComputed = useCallback((layout: LayoutItem[]) => {
    const offsets = new Array(layout.length).fill(0);
    layout.forEach(item => {
      offsets[item.globalIndex] = item.y;
    });
    setItemOffsets(offsets);
  }, []);

  const handleScrollPositionChange = useCallback((offsetY: number, totalHeight: number) => {
    setCurrentScrollY(offsetY);
    setTotalGridHeight(totalHeight);
  }, []);

  // Slides for lightbox
  const slides = useMemo(() => {
    return photos
      .filter(p => (p.media_type || 'image') !== 'audio')
      .map(p => ({
        src: thumbnails[p.id] || '',
        alt: p.filename,
      }));
  }, [photos, thumbnails]);

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
  const GRID_SPACING = 2;

  return (
    <div className="text-foreground flex flex-col h-screen bg-background relative overflow-hidden">
      {/* Header - gradient fade overlay */}
      <header
        className="fixed top-0 left-0 right-0 z-30 pointer-events-none"
        style={{
          paddingTop: isDesktop ? "32px" : "0px",
        }}
      >
        {/* Gradient background for fade effect */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, oklch(18.971% 0.00816 296.997) 0%, oklch(18.971% 0.00816 296.997 / 0.9) 50%, oklch(18.971% 0.00816 296.997 / 0) 100%)',
          }}
        />
        <div className="relative flex items-start justify-between p-4 pointer-events-auto">
          {/* Top Left: Chevron + Title row, Date below */}
          <div className="flex flex-col">
            {/* Row with Chevron + Title */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate({ to: "/" })}
                className="shrink-0 -ml-2 h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div
                className="group flex items-center gap-2 cursor-pointer"
                onClick={() => activeVault && setRenameOpen(true)}
              >
                <h1 className="text-xl font-bold tracking-tight">
                  {activeVault?.name || "Photos"}
                </h1>
              </div>
            </div>
            {/* Date below the chevron */}
            <p className="text-sm font-medium text-muted-foreground/70 ml-7">
              {activeDateLabel || "Timeline"}
            </p>
          </div>

          {/* Top Right: Actions */}
          <div className="flex items-center gap-3">
            {activeVault && (
              <ShareVaultDialog
                vaultId={activeVault.id}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full w-10 h-10 hover:bg-white/10"
                  >
                    <ShareIcon className="w-5 h-5 text-foreground" />
                  </Button>
                }
              />
            )}

            <UploadTrigger>
              <Button className="rounded-full px-5 font-semibold bg-secondary/60 text-secondary-foreground hover:bg-secondary/90 transition-colors backdrop-blur-2xl border border-white/10 shadow-2xl">
                Upload
              </Button>
            </UploadTrigger>
          </div>
        </div>
      </header>

      {/* Main Content - grid fills entire screen, content scrolls under header */}
      <main className="absolute inset-0">
        {photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p>No photos yet</p>
            <UploadTrigger />
          </div>
        ) : (
          <VirtualizedMasonryGrid
            items={mediaItems}
            columns={4}
            spacing={GRID_SPACING}
            paddingTop={isDesktop ? 120 : 100}
            paddingBottom={100}
            onItemClick={handleItemClick}
            onScrollPositionChange={handleScrollPositionChange}
            onLayoutComputed={handleLayoutComputed}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-auto min-w-[280px] max-w-[90vw]">
        <div
          className="backdrop-blur-2xl border border-white/10 shadow-2xl rounded-full p-1.5 h-14 bg-secondary/60"
        >
          <SegmentedControl
            value={viewMode}
            onChange={(v) => {
              setViewMode(v as any);
              // Navigation logic could go here
            }}
            items={[
              {
                value: 'memories',
                label: 'Memories',
                icon: <Sparkles className="w-5 h-5 mb-0.5" />
              },
              {
                value: 'library',
                label: 'Library',
                icon: <ImageIcon className="w-5 h-5 mb-0.5" />
              },
              {
                value: 'map',
                label: 'Map',
                icon: <MapIcon className="w-5 h-5 mb-0.5" />
              },
            ]}
          />
        </div>
      </div>

      {/* Global Components */}
      <Lightbox
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={() => setLightboxIndex(-1)}
        slides={slides}
        plugins={[Zoom]}
      />

      <AudioPlayer
        isOpen={!!audioPlayer}
        onClose={() => setAudioPlayer(null)}
        audioId={audioPlayer?.id || ''}
        filename={audioPlayer?.filename || ''}
      />

      {/* Invisible Uploader for handling file drops/selection */}
      <div className="hidden">
        <MultipleFileUploader />
      </div>

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
    </div>
  );
}