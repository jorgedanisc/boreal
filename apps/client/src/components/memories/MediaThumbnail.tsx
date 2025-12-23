import { invoke } from '@tauri-apps/api/core';
import { AudioLinesIcon, Music } from 'lucide-react';
import { useEffect, useState, memo } from 'react';
import { cn } from '@/lib/utils';

export interface MediaThumbnailProps {
  id: string;
  mediaType?: 'image' | 'video' | 'audio';
  thumbnail?: string; // Pre-loaded thumbnail base64
  className?: string;
  showFilename?: boolean;
  filename?: string;
  onClick?: () => void;
}

/**
 * Reusable MediaThumbnail component
 * Handles image/video thumbnails and audio placeholders consistently across the app
 */
export const MediaThumbnail = memo(function MediaThumbnail({
  id,
  mediaType = 'image',
  thumbnail: preloadedThumbnail,
  className,
  showFilename = false,
  filename,
  onClick,
}: MediaThumbnailProps) {
  const [thumbnail, setThumbnail] = useState<string | undefined>(preloadedThumbnail);
  const [loading, setLoading] = useState(!preloadedThumbnail && mediaType !== 'audio');

  // Load thumbnail if not provided and not audio
  useEffect(() => {
    if (preloadedThumbnail) {
      setThumbnail(preloadedThumbnail);
      setLoading(false);
      return;
    }

    if (mediaType === 'audio') {
      setLoading(false);
      return;
    }

    invoke<string>('get_thumbnail', { id })
      .then(t => {
        setThumbnail(t);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load thumbnail:', err);
        setLoading(false);
      });
  }, [id, preloadedThumbnail, mediaType]);

  // Audio item - show music icon
  if (mediaType === 'audio') {
    return (
      <div
        className={cn(
          "relative overflow-hidden bg-muted/30 w-full h-full rounded-2xl flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors",
          className
        )}
        onClick={onClick}
      >
        <div className="text-center p-2">
          <div className="w-10 h-10 bg-primary/20 flex items-center justify-center mx-auto rounded-full">
            <AudioLinesIcon className="w-5 h-5 text-primary" />
          </div>
          {showFilename && filename && (
            <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[80px] block mt-1">
              {filename}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className={cn("relative overflow-hidden bg-muted/30 w-full h-full rounded-2xl", className)}>
        <div className="w-full h-full animate-pulse bg-muted/50" />
      </div>
    );
  }

  // Image/Video thumbnail
  return (
    <div
      className={cn("relative overflow-hidden bg-muted/30 w-full h-full rounded-2xl cursor-pointer", className)}
      onClick={onClick}
    >
      {thumbnail ? (
        <img
          src={`data:image/webp;base64,${thumbnail}`}
          alt=""
          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
        />
      ) : (
        <div className="w-full h-full bg-muted/50 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No preview</span>
        </div>
      )}
    </div>
  );
});
