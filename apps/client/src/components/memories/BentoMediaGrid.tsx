import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, memo } from 'react';
import { getPhotos } from '@/lib/vault';
import { MediaThumbnail } from './MediaThumbnail';

export interface BentoMediaGridProps {
  mediaIds: string[];
  /** If true, show horizontal scroll instead of fixed bento grid */
  scrollable?: boolean;
}

/**
 * BentoMediaGrid - Shows media attachments in a mosaic-style grid
 * Used in memory cards (limited bento view) and memory detail page (scrollable)
 */
export const BentoMediaGrid = memo(({ mediaIds, scrollable = false }: BentoMediaGridProps) => {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [mediaTypes, setMediaTypes] = useState<Record<string, 'image' | 'video' | 'audio'>>({});

  // Fetch photos to get media type info
  useEffect(() => {
    getPhotos().then(photos => {
      const typeMap: Record<string, 'image' | 'video' | 'audio'> = {};
      photos.forEach(p => {
        if (mediaIds.includes(p.id)) {
          typeMap[p.id] = p.media_type || 'image';
        }
      });
      setMediaTypes(typeMap);
    }).catch(console.error);
  }, [mediaIds]);

  // Fetch thumbnails for non-audio items
  useEffect(() => {
    const idsToLoad = scrollable ? mediaIds : mediaIds.slice(0, 5);
    idsToLoad.forEach(id => {
      // Skip audio items (they don't have thumbnails)
      if (mediaTypes[id] === 'audio') return;

      invoke<string>('get_thumbnail', { id })
        .then(t => setThumbnails(prev => ({ ...prev, [id]: t })))
        .catch(console.error);
    });
  }, [mediaIds, mediaTypes, scrollable]);

  const count = mediaIds.length;

  // Empty state
  if (count === 0) return null;

  // Scrollable mode - horizontal bento scroll through all media
  if (scrollable) {
    return (
      <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        <div className="flex gap-2 p-2 w-max">
          {mediaIds.map((id, index) => {
            // Simple alternating pattern: large, then 2 small stacked, repeat
            const positionInGroup = index % 3;

            if (positionInGroup === 0) {
              // Large item
              return (
                <div
                  key={id}
                  className="shrink-0 overflow-hidden h-52 w-52"
                >
                  <MediaThumbnail
                    id={id}
                    mediaType={mediaTypes[id]}
                    thumbnail={thumbnails[id]}
                    className="h-full w-full"
                  />
                </div>
              );
            } else if (positionInGroup === 1) {
              // First of stacked pair - render both together
              const nextId = mediaIds[index + 1];
              return (
                <div key={id} className="shrink-0 flex flex-col gap-2 h-52">
                  <div className="overflow-hidden h-[100px] w-28">
                    <MediaThumbnail
                      id={id}
                      mediaType={mediaTypes[id]}
                      thumbnail={thumbnails[id]}
                      className="h-full w-full"
                    />
                  </div>
                  {nextId && (
                    <div className="overflow-hidden h-[100px] w-28">
                      <MediaThumbnail
                        id={nextId}
                        mediaType={mediaTypes[nextId]}
                        thumbnail={thumbnails[nextId]}
                        className="h-full w-full"
                      />
                    </div>
                  )}
                </div>
              );
            }
            // Skip position 2 (rendered with position 1)
            return null;
          })}
        </div>
      </div>
    );
  }

  // Single image - full width
  if (count === 1) {
    return (
      <div className="aspect-4/3 w-full p-1.5">
        <MediaThumbnail
          id={mediaIds[0]}
          mediaType={mediaTypes[mediaIds[0]]}
          thumbnail={thumbnails[mediaIds[0]]}
        />
      </div>
    );
  }

  // Two images - side by side
  if (count === 2) {
    return (
      <div className="aspect-4/3 grid grid-cols-2 gap-1.5 p-1.5">
        <MediaThumbnail
          id={mediaIds[0]}
          mediaType={mediaTypes[mediaIds[0]]}
          thumbnail={thumbnails[mediaIds[0]]}
        />
        <MediaThumbnail
          id={mediaIds[1]}
          mediaType={mediaTypes[mediaIds[1]]}
          thumbnail={thumbnails[mediaIds[1]]}
        />
      </div>
    );
  }

  // Three images - 1 large + 2 small
  if (count === 3) {
    return (
      <div className="aspect-4/3 grid grid-cols-3 grid-rows-2 gap-1.5 p-1.5">
        <div className="col-span-2 row-span-2">
          <MediaThumbnail
            id={mediaIds[0]}
            mediaType={mediaTypes[mediaIds[0]]}
            thumbnail={thumbnails[mediaIds[0]]}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaThumbnail
            id={mediaIds[1]}
            mediaType={mediaTypes[mediaIds[1]]}
            thumbnail={thumbnails[mediaIds[1]]}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaThumbnail
            id={mediaIds[2]}
            mediaType={mediaTypes[mediaIds[2]]}
            thumbnail={thumbnails[mediaIds[2]]}
          />
        </div>
      </div>
    );
  }

  // Four images - 1 large + 3 small
  if (count === 4) {
    return (
      <div className="aspect-4/3 grid grid-cols-3 grid-rows-2 gap-1.5 p-1.5">
        <div className="col-span-2 row-span-2">
          <MediaThumbnail
            id={mediaIds[0]}
            mediaType={mediaTypes[mediaIds[0]]}
            thumbnail={thumbnails[mediaIds[0]]}
          />
        </div>
        <div className="col-span-1 row-span-1">
          <MediaThumbnail
            id={mediaIds[1]}
            mediaType={mediaTypes[mediaIds[1]]}
            thumbnail={thumbnails[mediaIds[1]]}
          />
        </div>
        <div className="col-span-1 row-span-1 grid grid-cols-2 gap-1.5">
          <MediaThumbnail
            id={mediaIds[2]}
            mediaType={mediaTypes[mediaIds[2]]}
            thumbnail={thumbnails[mediaIds[2]]}
          />
          <MediaThumbnail
            id={mediaIds[3]}
            mediaType={mediaTypes[mediaIds[3]]}
            thumbnail={thumbnails[mediaIds[3]]}
          />
        </div>
      </div>
    );
  }

  // 5 or more - 1 large left (2 rows) + 2x2 grid on right with +N overlay
  return (
    <div className="aspect-4/3 grid grid-cols-3 grid-rows-2 gap-1.5 p-1.5">
      {/* Large image taking 2/3 width and full height */}
      <div className="col-span-2 row-span-2">
        <MediaThumbnail
          id={mediaIds[0]}
          mediaType={mediaTypes[mediaIds[0]]}
          thumbnail={thumbnails[mediaIds[0]]}
        />
      </div>

      {/* Top right small image */}
      <div className="col-span-1 row-span-1">
        <MediaThumbnail
          id={mediaIds[1]}
          mediaType={mediaTypes[mediaIds[1]]}
          thumbnail={thumbnails[mediaIds[1]]}
        />
      </div>

      {/* Bottom right - 2 images side by side */}
      <div className="col-span-1 row-span-1 grid grid-cols-2 gap-1.5">
        <MediaThumbnail
          id={mediaIds[2]}
          mediaType={mediaTypes[mediaIds[2]]}
          thumbnail={thumbnails[mediaIds[2]]}
        />
        <div className="relative overflow-hidden rounded-lg">
          <MediaThumbnail
            id={mediaIds[3]}
            mediaType={mediaTypes[mediaIds[3]]}
            thumbnail={thumbnails[mediaIds[3]]}
          />
          {count > 4 && (
            <div className="absolute inset-0 backdrop-blur-[2px] flex items-center justify-center rounded-lg">
              <span className="text-white font-semibold text-base">+{count - 4}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
