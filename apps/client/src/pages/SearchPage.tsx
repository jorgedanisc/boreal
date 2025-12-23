import { Button } from '@/components/ui/button';
import { VirtualizedMasonryGrid, MediaItem } from '@/components/gallery/MasonryGrid';
import { AudioPlayer } from '@/components/gallery/AudioPlayer';
import { getAllPhotos, getThumbnailForVault, PhotoWithVault } from '@/lib/vault';
import { useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, SearchIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlobalPhotoSlider, PhotoMetadata } from '@/components/gallery/PhotoLightbox';
import 'react-photo-view/dist/react-photo-view.css';

export function SearchPage() {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  const [query, setQuery] = useState('');
  const [allPhotos, setAllPhotos] = useState<PhotoWithVault[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [audioPlayer, setAudioPlayer] = useState<{ id: string; filename: string } | null>(null);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  // Load all photos on mount
  useEffect(() => {
    loadPhotos();
  }, []);

  const loadPhotos = async () => {
    try {
      setIsLoading(true);
      const photos = await getAllPhotos();
      setAllPhotos(photos);

      // Load thumbnails in batches
      const BATCH_SIZE = 10;
      const imageVideoPhotos = photos.filter((p: PhotoWithVault) => (p.media_type || 'image') !== 'audio');

      for (let i = 0; i < imageVideoPhotos.length; i += BATCH_SIZE) {
        const batch = imageVideoPhotos.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (p: PhotoWithVault) => {
          try {
            const b64 = await getThumbnailForVault(p.id, p.vault_id);
            if (b64) {
              setThumbnails(prev => ({ ...prev, [p.id]: `data:image/webp;base64,${b64}` }));
            }
          } catch (e) {
            console.error(`Failed to load thumbnail for ${p.id}`, e);
          }
        }));
      }
    } catch (e) {
      console.error('Failed to load photos:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter photos based on query
  const filteredPhotos = useMemo(() => {
    if (!query.trim()) return allPhotos;
    const lowerQuery = query.toLowerCase().trim();
    return allPhotos.filter(p =>
      p.filename.toLowerCase().includes(lowerQuery)
    );
  }, [allPhotos, query]);

  // Media items for masonry grid
  const mediaItems: MediaItem[] = useMemo(() => {
    return filteredPhotos.map(p => {
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
  }, [filteredPhotos, thumbnails]);

  // Slides for lightbox (exclude audio)
  // Slides for lightbox (exclude audio)
  const lightboxPhotos = useMemo(() => {
    return filteredPhotos
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
        vault_id: p.vault_id
      }));
  }, [filteredPhotos]);

  const handleItemClick = (index: number) => {
    const photo = filteredPhotos[index];
    const mediaType = photo?.media_type || 'image';

    if (mediaType === 'audio') {
      setAudioPlayer({ id: photo.id, filename: photo.filename });
    } else {
      const filteredForLightbox = filteredPhotos.filter(p => (p.media_type || 'image') !== 'audio');
      const lightboxIdx = filteredForLightbox.findIndex(p => p.id === photo.id);
      setLightboxIndex(lightboxIdx);
    }
  };

  const clearSearch = () => {
    setQuery('');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative text-foreground flex flex-col h-screen overflow-hidden"
    >
      {/* Header */}
      <header
        className="absolute top-0 left-0 right-0 z-30"
        style={{ paddingTop: isDesktop ? "32px" : "env(safe-area-inset-top)" }}
      >
        <div
          className="fixed w-dvw top-0 left-0 right-0 pointer-events-none z-5"
          style={{
            background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.55) 25%, rgba(0, 0, 0, 0.4) 45%, rgba(0, 0, 0, 0.25) 60%, rgba(0, 0, 0, 0.12) 75%, rgba(0, 0, 0, 0.04) 88%, transparent 100%)',
            height: isDesktop ? 'calc(32px + 240px)' : 'calc(env(safe-area-inset-top) + 240px)',
          }}
        />
        <div className="relative px-4 pt-4 pb-2 pl-safe pr-safe z-10">
          {/* Top Row: Search Input + Close Button */}
          <div className="flex items-center gap-3">
            {/* Enhanced search input with motion */}
            <motion.div
              className="flex-1 relative"
              whileFocus={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute z-10 inset-y-0 left-3 flex items-center pointer-events-none">
                <SearchIcon className="size-4 text-secondary-foreground" />
              </div>
              <motion.input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full h-10 pl-10 pr-10 rounded-full bg-secondary/60 backdrop-blur-md border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                whileFocus={{
                  scale: 1.01,
                  boxShadow: "0 0 0 2px hsl(var(--primary) / 0.3)"
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              />
              {query && (
                <button
                  onClick={clearSearch}
                  className="absolute inset-y-0 right-3 flex items-center"
                >
                  <XIcon className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                </button>
              )}
            </motion.div>

            <Button
              variant="glass"
              className="shrink-0 h-9 w-9 p-0 rounded-full"
              onClick={() => navigate({ to: "/" })}
            >
              <XIcon className="w-5 h-5 text-foreground" />
            </Button>
          </div>

          {/* AI Detection - muted styling */}
          <div className="flex items-center mt-3 px-1">
            <span className="text-xs text-muted-foreground/60">AI Detection Off</span>
          </div>

          {/* Results Count */}
          <AnimatePresence mode="wait">
            <motion.p
              key={filteredPhotos.length}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="text-sm font-medium text-muted-foreground mt-2 px-1"
            >
              {filteredPhotos.length} {filteredPhotos.length === 1 ? 'Result' : 'Results'}
            </motion.p>
          </AnimatePresence>
        </div>
      </header>

      {/* Main Content */}
      <main className="absolute inset-0">
        {!isLoading && filteredPhotos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <SearchIcon className="w-12 h-12 opacity-30" />
            <p>{query ? 'No results found' : 'No photos in any vault'}</p>
          </div>
        ) : (
          <VirtualizedMasonryGrid
            items={mediaItems}
            columns={4}
            spacing={5}
            paddingTop={isDesktop ? 200 : "calc(200px + env(safe-area-inset-top))"}
            paddingBottom="calc(40px + env(safe-area-inset-bottom))"
            onItemClick={handleItemClick}
          />
        )}
      </main>

      {/* PhotoSlider for lightbox */}
      <GlobalPhotoSlider
        photos={lightboxPhotos as unknown as PhotoMetadata[]}
        thumbnails={thumbnails}
        visible={lightboxIndex >= 0}
        onClose={() => setLightboxIndex(-1)}
        index={lightboxIndex >= 0 ? lightboxIndex : 0}
        onIndexChange={setLightboxIndex}
        onPhotoUpdate={(id, updates) => {
          setAllPhotos(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
        }}
      />

      {/* Audio Player */}
      <AudioPlayer
        isOpen={!!audioPlayer}
        onClose={() => setAudioPlayer(null)}
        audioId={audioPlayer?.id || ''}
        filename={audioPlayer?.filename || ''}
      />
    </motion.div>
  );
}
