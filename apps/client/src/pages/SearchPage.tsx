import { Button } from '@/components/ui/button';
import { toast } from "sonner";
import { VirtualizedMasonryGrid, MediaItem } from '@/components/gallery/MasonryGrid';
import { AudioPlayer } from '@/components/gallery/AudioPlayer';
import { getAllPhotos, getThumbnailForVault, PhotoWithVault } from '@/lib/vault';
import { useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { motion, AnimatePresence } from 'motion/react';
import { SearchIcon, XIcon, SparklesIcon, CheckCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { GlobalPhotoSlider, PhotoMetadata } from '@/components/gallery/PhotoLightbox';
import 'react-photo-view/dist/react-photo-view.css';
import { IconCloudDownload, IconLoader } from '@tabler/icons-react';



interface SemanticSearchResult {
  id: string;
  score: number;
}

interface EmbeddingStatus {
  available: boolean;
  ready: boolean;
  indexed_count: number;
}

interface DownloadPayload {
  filename: string;
  downloaded: number;
  total: number;
}

export function SearchPage() {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  const [query, setQuery] = useState('');
  const [allPhotos, setAllPhotos] = useState<PhotoWithVault[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [audioPlayer, setAudioPlayer] = useState<{ id: string; filename: string } | null>(null);

  // AI Search state
  const [modelStatus, setModelStatus] = useState<EmbeddingStatus>({ available: false, ready: false, indexed_count: 0 });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number; label: string } | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);

  // Ref for cleanup
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  // Check status from backend
  const checkStatus = useCallback(async () => {
    try {
      const status = await invoke<EmbeddingStatus>('get_embedding_status');
      setModelStatus(status);
    } catch (e) {
      console.error("Failed to get embedding status:", e);
      // toast.error(`Status Check Failed: ${e}`);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    // Poll every 5 seconds to update count/ready state
    const interval = setInterval(checkStatus, 5000);

    // Setup download progress listener
    const setupListener = async () => {
      const unlisten = await listen<DownloadPayload>('download_progress', (event) => {
        setDownloadProgress(prev => {
          if (!prev) return null;
          // Only update if it matches current expectation or general update
          return {
            ...prev,
            downloaded: event.payload.downloaded,
            total: event.payload.total > 0 ? event.payload.total : prev.total
          };
        });
      });
      unlistenRef.current = unlisten;
    };
    setupListener();

    return () => {
      clearInterval(interval);
      if (unlistenRef.current) unlistenRef.current();
    };
  }, [checkStatus]);

  // Auto-index when ready
  useEffect(() => {
    if (modelStatus.ready && !isIndexing) {
      // Trigger background indexing
      // Ideally we check if we need to index, but the backend command 
      // `embed_all_photos` checks for diffs internally, so it's safe to call.
      // We can debounce or just call it once per session/ready-state.
      handleIndex();
    }

    // Auto-init if models are available but not ready
    if (modelStatus.available && !modelStatus.ready && !isDownloading) {
      console.log("Auto-initializing embedding models...");
      invoke('init_embedding_models')
        .then(() => checkStatus())
        .catch(e => {
          console.error("Auto-init failed", e);
          // toast.error(`Auto-init Failed: ${e}`);
        });
    }
  }, [modelStatus.ready, modelStatus.available]);

  const handleDownloadAndEnable = async () => {
    if (isDownloading) return;
    setIsDownloading(true);

    try {
      // 1. Download Models (Backend Orchestration)
      setDownloadProgress({ downloaded: 0, total: 0, label: "Starting download..." });
      await invoke('download_models');

      setDownloadProgress({ downloaded: 1, total: 1, label: "Initializing Models..." });

      // 4. Initialize
      await invoke('init_embedding_models');
      await checkStatus();

      toast.success("AI Models setup complete!");

    } catch (e) {
      console.error("Failed to setup models:", e);
      toast.error(`Model Setup Failed: ${e}`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleIndex = async () => {
    if (isIndexing) return;
    setIsIndexing(true);
    try {
      await invoke('embed_all_photos');
      await checkStatus();
    } catch (e) {
      console.error("Indexing failed:", e);
    } finally {
      setIsIndexing(false);
    }
  };

  // Load all photos on mount
  useEffect(() => {
    loadPhotos();
  }, []);

  const loadPhotos = async () => {
    try {
      setIsLoading(true);
      const photos = await getAllPhotos();
      setAllPhotos(photos);
      setIsLoading(false);

      // Load thumbnails in batches
      const BATCH_SIZE = 10;
      const imageVideoPhotos = photos.filter((p: PhotoWithVault) => {
        const mediaType = p.media_type || 'image';
        if (mediaType === 'audio') return false;
        if (p.filename) {
          const ext = p.filename.toLowerCase().split('.').pop();
          if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext || '')) {
            return false;
          }
        }
        return true;
      });

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
      setIsLoading(false);
    }
  };

  // Combined search: semantic + filename (debounced for semantic)
  useEffect(() => {
    if (!query.trim()) {
      setSemanticResults([]);
      return;
    }

    // Only do semantic search if AI is ready
    if (!modelStatus.ready) return;

    const timer = setTimeout(async () => {
      try {
        const results = await invoke<SemanticSearchResult[]>('search_photos_semantic', {
          query: query.trim(),
          limit: 100
        });
        setSemanticResults(results);
      } catch (e) {
        console.error('Semantic search failed:', e);
        setSemanticResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, modelStatus.ready]);

  // Filter photos: combine semantic results + filename matches, deduplicated
  const filteredPhotos = useMemo(() => {
    if (!query.trim()) return allPhotos;

    const lowerQuery = query.toLowerCase().trim();

    // Filename matches
    const filenameMatches = new Set(
      allPhotos
        .filter(p => p.filename.toLowerCase().includes(lowerQuery))
        .map(p => p.id)
    );

    // Semantic matches (with scores)
    const semanticScores = new Map(semanticResults.map(r => [r.id, r.score]));

    // Date matching (DD/MM/YYYY)
    const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    const dateMatch = query.match(dateRegex);
    let dateMatches = new Set<string>();

    if (dateMatch) {
      const [_, day, month, year] = dateMatch;
      const d = day.padStart(2, '0');
      const m = month.padStart(2, '0');
      const searchDate = `${year}-${m}-${d}`;

      dateMatches = new Set(
        allPhotos
          .filter(p => {
            const created = p.created_at.startsWith(searchDate);
            const captured = p.captured_at ? p.captured_at.startsWith(searchDate) : false;
            return created || captured;
          })
          .map(p => p.id)
      );
    }

    // Combine: semantic results -> date matches -> filename matches
    const semanticIds = new Set(semanticResults.map(r => r.id));
    const results: PhotoWithVault[] = [];

    // 1. Semantic results (sorted by score)
    const semanticPhotos = allPhotos
      .filter(p => semanticIds.has(p.id))
      .sort((a, b) => (semanticScores.get(b.id) || 0) - (semanticScores.get(a.id) || 0));
    results.push(...semanticPhotos);

    // 2. Date matches (if not already in semantic)
    if (dateMatches.size > 0) {
      const datePhotos = allPhotos.filter(
        p => dateMatches.has(p.id) && !semanticIds.has(p.id)
      );
      results.push(...datePhotos);
    }

    // 3. Filename matches (if not already added)
    const filenameOnlyPhotos = allPhotos.filter(
      p => filenameMatches.has(p.id) && !semanticIds.has(p.id) && !dateMatches.has(p.id)
    );
    results.push(...filenameOnlyPhotos);

    return results;
  }, [allPhotos, query, semanticResults]);

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
            height: isDesktop ? 'calc(32px + 200px)' : 'calc(env(safe-area-inset-top) + 200px)',
          }}
        />
        <div className="relative px-4 pt-4 pb-2 pl-safe pr-safe z-10">
          <div className="flex items-center gap-3">
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
                placeholder={modelStatus.ready ? "Search by contents or filename..." : "Search by filename..."}
                className="w-full h-10 pl-10 pr-10 rounded-full bg-secondary/60 backdrop-blur-md border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                whileFocus={{
                  scale: 1.01,
                  boxShadow: "0 0 0 2px hsl(var(--primary) / 0.3)"
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              />
              {query && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); clearSearch(); }}
                  className="absolute inset-y-0 right-3 flex items-center"
                >
                  <XIcon className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                </button>
              )}
            </motion.div>

            <motion.button
              className="shrink-0 size-10 p-0 rounded-full border border-white/10 bg-secondary/60 hover:bg-secondary/80 backdrop-blur-md flex items-center justify-center transition-colors pointer-events-auto"
              onClick={() => navigate({ to: "/" })}
            >
              <XIcon className="w-5 h-5 text-foreground" />
            </motion.button>
          </div>

          <div className="flex items-center gap-4 mt-3 ml-4 px-1 min-h-[30px]">
            <div className="flex items-center gap-4">
              <AnimatePresence mode="wait" initial={false}>
                {!isLoading && (
                  <motion.p
                    key={`count-${filteredPhotos.length}`}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="text-sm font-medium text-muted-foreground"
                  >
                    {filteredPhotos.length} {filteredPhotos.length === 1 ? 'Result' : 'Results'}
                    {modelStatus.ready && <span className="text-xs ml-2 opacity-60">({modelStatus.indexed_count} indexed)</span>}
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {!modelStatus.ready && isDesktop && (
                  <motion.div
                    key="download-btn"
                    initial={{ opacity: 0, scale: 0.9, width: 0 }}
                    animate={{ opacity: 1, scale: 1, width: 'auto' }}
                    exit={{ opacity: 0, scale: 0.9, width: 0 }}
                    className="overflow-hidden"
                  >
                    <Button
                      variant="outline"
                      size="xs"
                      className="rounded-full h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
                      onClick={handleDownloadAndEnable}
                      disabled={isDownloading || (modelStatus.available && !modelStatus.ready && !isDownloading)}
                    >
                      {isDownloading ? (
                        <>
                          <IconLoader className="w-4 h-4 mr-2 animate-spin" />
                          {downloadProgress ? `${downloadProgress.label} ${Math.floor((downloadProgress.downloaded / downloadProgress.total) * 100)}%` : 'Downloading...'}
                        </>
                      ) : modelStatus.available ? (
                        <>
                          <IconLoader className="w-4 h-4 mr-2 animate-spin" />
                          Initializing...
                        </>
                      ) : (
                        <>
                          <IconCloudDownload className="w-4 h-4 mr-2" />
                          Enable Vision Search (375MB)
                        </>
                      )}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

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
            paddingTop={isDesktop ? 180 : "calc(180px + env(safe-area-inset-top))"}
            paddingBottom="calc(40px + env(safe-area-inset-bottom))"
            onItemClick={handleItemClick}
          />
        )}
      </main>

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

      <AudioPlayer
        isOpen={!!audioPlayer}
        onClose={() => setAudioPlayer(null)}
        audioId={audioPlayer?.id || ''}
        filename={audioPlayer?.filename || ''}
      />
    </motion.div >
  );
}
