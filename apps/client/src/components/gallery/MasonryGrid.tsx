import { useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGesture } from '@use-gesture/react';
import { Music } from 'lucide-react';

export interface MediaItem {
  id: string;
  src: string; // Thumbnail URL (base64 or empty for audio)
  width: number;
  height: number;
  alt: string;
  mediaType: 'image' | 'video' | 'audio';
}

interface MasonryGridProps {
  items: MediaItem[];
  columns?: number;
  spacing?: number;
  onItemClick?: (index: number) => void;
  onColumnsChange?: (columns: number) => void;
}

/**
 * Custom masonry grid with motion animations
 * Supports pinch-to-zoom (column adjustment) and smooth layout transitions
 */
export function MasonryGrid({
  items,
  columns: initialColumns = 4,
  spacing = 4,
  onItemClick,
  onColumnsChange,
}: MasonryGridProps) {
  const [columns, setColumns] = useState(initialColumns);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate which column each item goes into for masonry effect
  const columnItems = useMemo(() => {
    const cols: MediaItem[][] = Array.from({ length: columns }, () => []);
    const heights = Array(columns).fill(0);

    items.forEach((item) => {
      // Find shortest column
      const shortestCol = heights.indexOf(Math.min(...heights));
      cols[shortestCol].push(item);

      // Estimate height based on aspect ratio (or fixed for audio)
      const aspectRatio = item.mediaType === 'audio'
        ? 1
        : (item.height / item.width) || 1;
      heights[shortestCol] += aspectRatio;
    });

    return cols;
  }, [items, columns]);

  // Column adjustment handler
  const adjustColumns = useCallback((delta: number) => {
    setColumns((c) => {
      const newCols = Math.max(2, Math.min(8, c + delta));
      onColumnsChange?.(newCols);
      return newCols;
    });
  }, [onColumnsChange]);

  // Gestures: pinch to zoom & ctrl/cmd + wheel
  useGesture(
    {
      onPinch: ({ offset: [d], memo, last, down }) => {
        if (!memo) memo = columns;

        // Visual feedback during pinch could use transform: scale (future improvement)
        // For now, simple column snapping with tuned transition

        if (d > 1.5 && columns > 2) {
          adjustColumns(-1);
          return columns;
        } else if (d < 0.7 && columns < 8) {
          adjustColumns(1);
          return columns;
        }
        return memo;
      },
      onWheel: ({ delta: [, dy], ctrlKey, metaKey }) => {
        if (ctrlKey || metaKey) {
          if (dy < -20 && columns > 2) adjustColumns(-1);
          else if (dy > 20 && columns < 8) adjustColumns(1);
        }
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
    }
  );

  // Find global index for an item
  const getGlobalIndex = useCallback((item: MediaItem) => {
    return items.findIndex((i) => i.id === item.id);
  }, [items]);

  return (
    <div
      ref={containerRef}
      className="w-full touch-pan-y"
      style={{ touchAction: 'pan-y' }}
    >
      <motion.div
        layout
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: spacing,
        }}
        // Smoother, less bouncy transition for layout changes
        transition={{ type: 'spring', stiffness: 200, damping: 25, mass: 0.5 }}
      >
        {columnItems.map((column, colIndex) => (
          <div key={colIndex} className="flex flex-col" style={{ gap: spacing }}>
            <AnimatePresence mode="popLayout">
              {column.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="relative cursor-pointer overflow-hidden rounded-sm"
                  onClick={() => onItemClick?.(getGlobalIndex(item))}
                >
                  <GridItem item={item} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Render individual grid item based on media type
 */
function GridItem({ item }: { item: MediaItem }) {
  // Use width/height from item (defaults to 1 if missing)
  // Ensure we don't divide by zero
  const w = item.width || 500;
  const h = item.height || 500;
  const ratio = w / h;

  // Audio: show music icon placeholder (square)
  if (item.mediaType === 'audio') {
    return (
      <div
        className="bg-muted/30 border border-border flex items-center justify-center group hover:bg-muted/50 transition-colors"
        style={{ aspectRatio: '1/1' }}
      >
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
            <Music className="w-6 h-6 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground truncate max-w-[100px] block">
            {item.alt}
          </span>
        </div>
      </div>
    );
  }

  // Image/Video: show thumbnail
  // Use aspect-ratio CSS property
  return (
    <div className="relative w-full" style={{ aspectRatio: ratio }}>
      {item.src ? (
        <motion.img
          src={item.src}
          alt={item.alt}
          className="w-full h-full object-cover absolute inset-0"
          whileHover={{ scale: 1.05 }}
          transition={{ duration: 0.2 }}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-muted animate-pulse absolute inset-0" />
      )}
    </div>
  );
}
