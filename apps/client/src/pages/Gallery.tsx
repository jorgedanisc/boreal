import { useState, useEffect, useMemo, useRef } from 'react';
import { getPhotos, getThumbnail, Photo, getActiveVault, VaultPublic } from '../lib/vault';
import { ChevronLeft, Image as ImageIcon } from 'lucide-react';
import { ShareVaultDialog } from '../components/vault/ShareVaultDialog';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { UploadPanel } from '@/components/upload/UploadPanel';
import { UploadTrigger } from '@/components/upload/UploadTrigger';
import { useUploadStore } from '@/stores/upload_store';
import { invoke } from '@tauri-apps/api/core';

// Gallery Libraries
import PhotoAlbum from "react-photo-album";
import "react-photo-album/masonry.css";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

// Gestures
import { useGesture } from '@use-gesture/react';

export default function Gallery() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);
  const { getCompletedCount } = useUploadStore();
  const [lastCompletedCount, setLastCompletedCount] = useState(0);

  // Layout State
  const [columns, setColumns] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lightbox State
  const [index, setIndex] = useState(-1);

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

      // Load thumbnails lazily
      const BATCH_SIZE = 10;
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (p) => {
          if (!thumbnails[p.id]) {
            try {
              const b64 = await getThumbnail(p.id);
              // Use WebP MIME type as per backend changes
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
  useEffect(() => {
    const currentCompleted = getCompletedCount();
    if (currentCompleted > lastCompletedCount) {
      loadPhotos();
      setLastCompletedCount(currentCompleted);
    }
  }, [getCompletedCount()]);

  // Gestures for Pinch-to-Zoom (Column adjustment)
  useGesture(
    {
      onPinch: ({ offset: [d], memo }) => {
        // d is scale factor relative to initial touch
        if (!memo) memo = columns;

        // Simple logic: zoom in (d > 1) -> fewer columns, zoom out (d < 1) -> more columns
        if (d > 1.1 && columns > 2) {
          setColumns(c => Math.max(2, c - 1));
          return columns;
        } else if (d < 0.9 && columns < 8) {
          setColumns(c => Math.min(8, c + 1));
          return columns;
        }
        return memo;
      },
      onWheel: ({ delta: [, dy], active, memo, ctrlKey, metaKey }) => {
        if (!active) return;
        if (!memo) memo = columns;

        // Strictly require Ctrl (Windows/Linux) or Meta (Mac Command) key for zoom
        if (ctrlKey || metaKey) {
          if (dy < -20 && columns > 2) {
            setColumns(c => Math.max(2, c - 1));
            return columns;
          } else if (dy > 20 && columns < 8) {
            setColumns(c => Math.min(8, c + 1));
            return columns;
          }
        }
        return memo;
      }
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      wheel: { eventOptions: { passive: false, modifierKey: undefined } } // We handle modifier key manually
    }
  );

  // Map photos to React Photo Album format
  const albumPhotos = useMemo(() => {
    return photos.map(p => {
      // Fallback dimensions if 0
      const width = p.width > 0 ? p.width : 500;
      const height = p.height > 0 ? p.height : 500;

      return {
        src: thumbnails[p.id] || "", // Thumbnail for grid
        width,
        height,
        key: p.id,
        alt: p.filename,
        // Extra data for Lightbox
        originalKey: p.s3_key,
        mediaType: p.filename.match(/\.(mp4|mov|avi|mkv)$/i) ? 'video' :
          p.filename.match(/\.(mp3|wav|ogg|m4a|flac)$/i) ? 'audio' : 'image',
      };
    });
  }, [photos, thumbnails]);

  // Lightbox slides
  const slides = useMemo(() => {
    return photos.map(p => {
      const isVideo = p.filename.match(/\.(mp4|mov|avi|mkv)$/i);
      const isAudio = p.filename.match(/\.(mp3|wav|ogg|m4a|flac)$/i);

      if (isVideo) {
        return {
          type: "video" as const,
          // TODO: Real streaming URL
          sources: [
            {
              src: "",
              type: "video/mp4"
            }
          ],
          poster: thumbnails[p.id]
        }
      } else if (isAudio) {
        // TODO: Audio player support in Lightbox or separate player
        return {
          type: "image", // Fallback for now until audio plugin is added
          src: thumbnails[p.id] || "",
          alt: "Audio file"
        };
      } else {
        return { src: thumbnails[p.id] };
      }
    })
  }, [photos, thumbnails]);


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

      <main
        ref={containerRef}
        className="flex-1 p-0 touch-pan-y"
        style={{ touchAction: 'pan-y' }}
      >
        {photos.length === 0 ? (
          <div className="h-[50vh] flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p>No photos yet</p>
            <UploadTrigger />
          </div>
        ) : (
          <PhotoAlbum
            layout="masonry"
            photos={albumPhotos}
            columns={columns}
            spacing={2}
            onClick={({ index }) => setIndex(index)}
            render={{
              image: (props) => {
                // Fix TS error: context is not on RenderImageProps type definition by default
                const { src, width, height, style, context, ...rest } = props as any;
                const mediaType = (context?.photo as any)?.mediaType;

                if (!src && mediaType !== 'audio') {
                  return (
                    <div
                      style={{ ...style, width: "100%", aspectRatio: `${width}/${height}` }}
                      className="bg-muted animate-pulse"
                    />
                  );
                }

                if (mediaType === 'audio') {
                  return (
                    <div
                      style={{ ...style }}
                      className="bg-muted/30 border border-border flex items-center justify-center group cursor-pointer hover:bg-muted/50 transition-colors"
                      {...rest}
                    >
                      <div className="text-center p-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground truncate max-w-[100px] block">
                          {(context?.photo as any)?.alt}
                        </span>
                      </div>
                    </div>
                  );
                }

                return <img src={src} style={style} {...rest} className="transition-opacity duration-300 hover:brightness-110 cursor-pointer" />;
              }
            }}
          />
        )}
      </main>

      <Lightbox
        open={index >= 0}
        index={index}
        close={() => setIndex(-1)}
        slides={slides as any[]}
        plugins={[Video, Zoom]}
      />

      {/* Upload Panel - Fixed at Bottom Center */}
      <UploadPanel />
    </div>
  );
}