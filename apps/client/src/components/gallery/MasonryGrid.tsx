import { useGesture } from '@use-gesture/react';
import { AudioLinesIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';

export interface MediaItem {
  id: string;
  src: string; // Thumbnail URL (base64 or empty for audio)
  width: number;
  height: number;
  alt: string;
  mediaType: 'image' | 'video' | 'audio';
  capturedAt?: string; // ISO date string for timeline grouping
}

interface VirtualizedMasonryGridProps {
  items: MediaItem[];
  columns?: number;
  spacing?: number;
  paddingX?: number; // Horizontal padding for the grid container
  paddingTop?: number | string; // Top padding (for fixed header)
  paddingBottom?: number | string; // Bottom padding (for fixed bottom nav)
  onItemClick?: (index: number) => void;
  onColumnsChange?: (columns: number) => void;
  onScrollPositionChange?: (offsetY: number, totalHeight: number) => void;
  scrollToOffset?: number; // External scroll control for timeline scrubber
  onLayoutComputed?: (layout: LayoutItem[]) => void;
}

// Column limits
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;

// CSS transition duration for smooth zooming
const TRANSITION_DURATION = '0.3s';

export interface LayoutItem {
  item: MediaItem;
  x: number;
  y: number;
  width: number;
  height: number;
  globalIndex: number;
}

/**
 * Virtualized Masonry Grid
 * 
 * Uses TanStack Virtual for efficient rendering of large galleries.
 * Only renders items within the visible viewport + overscan.
 */
export function VirtualizedMasonryGrid({
  items,
  columns: initialColumns = 4,
  spacing = 8,
  //   paddingX = 0, // Unused
  paddingTop = 0,
  paddingBottom = 0,
  onItemClick,
  onColumnsChange,
  onScrollPositionChange,
  scrollToOffset,
  onLayoutComputed,
}: VirtualizedMasonryGridProps) {
  const [columns, setColumns] = useState(initialColumns);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { width: containerWidth = 0 } = useResizeObserver({
    ref: containerRef as any,
    box: 'border-box',
  });

  /**
   * Calculate complete layout for all items
   */
  const { layout, totalHeight } = useMemo(() => {
    if (!containerWidth || columns === 0 || items.length === 0) {
      return { layout: [] as LayoutItem[], totalHeight: 0 };
    }

    // Row-based (Justified) Layout
    // We treat 'columns' as the target number of items per row, which defines the target row height.
    const targetRowHeight = (containerWidth - (columns - 1) * spacing) / columns;
    const fullLayout: LayoutItem[] = [];

    let currentRow: { item: MediaItem; globalIndex: number; ratio: number; widthAtTarget: number }[] = [];
    let currentY = 0;
    let currentRowWidth = 0;

    items.forEach((item, globalIndex) => {
      const w = item.width > 0 ? item.width : 1;
      const h = item.height > 0 ? item.height : 1;
      const ratio = item.mediaType === 'audio' ? 1 : (w / h);

      const widthAtTarget = targetRowHeight * ratio;

      currentRow.push({ item, globalIndex, ratio, widthAtTarget });
      currentRowWidth += widthAtTarget;

      // Check if we interpret the row as full
      // We check if the width (plus spacings) is >= containerWidth
      const rowGap = (currentRow.length - 1) * spacing;
      if (currentRowWidth + rowGap >= containerWidth) {
        // Finalize row
        // Calculate exact height to fill containerWidth
        // containerWidth = sum(widths) + gaps
        // containerWidth = h * sum(ratios) + gaps
        // h = (containerWidth - gaps) / sum(ratios)

        const sumRatios = currentRow.reduce((sum, it) => sum + it.ratio, 0);
        // Ensure we don't divide by zero or have weird behavior
        const finalRowHeight = (containerWidth - rowGap) / sumRatios;

        let currentX = 0;
        currentRow.forEach((rowItem) => {
          const itemWidth = finalRowHeight * rowItem.ratio;
          fullLayout.push({
            item: rowItem.item,
            x: currentX,
            y: currentY,
            width: itemWidth,
            height: finalRowHeight,
            globalIndex: rowItem.globalIndex
          });
          currentX += itemWidth + spacing;
        });

        currentY += finalRowHeight + spacing;
        currentRow = [];
        currentRowWidth = 0;
      }
    });

    // Handle remaining items (Last row)
    // We don't stretch them, we just keep targetRowHeight and align left
    if (currentRow.length > 0) {
      let currentX = 0;
      currentRow.forEach((rowItem) => {
        // Use target height
        const itemWidth = rowItem.widthAtTarget;
        fullLayout.push({
          item: rowItem.item,
          x: currentX,
          y: currentY,
          width: itemWidth,
          height: targetRowHeight,
          globalIndex: rowItem.globalIndex
        });
        currentX += itemWidth + spacing;
      });
      currentY += targetRowHeight + spacing;
    }

    return {
      layout: fullLayout,
      totalHeight: Math.max(currentY - spacing, 0),
    };
  }, [items, columns, containerWidth, spacing]);

  // Report layout back to parent
  useEffect(() => {
    if (onLayoutComputed) {
      onLayoutComputed(layout);
    }
  }, [layout, onLayoutComputed]);

  // Notify parent of scroll position changes for timeline sync
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !onScrollPositionChange) return;

    const handleScroll = () => {
      onScrollPositionChange(scrollElement.scrollTop, totalHeight);
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [onScrollPositionChange, totalHeight]);

  // External scroll control (from timeline scrubber)
  useEffect(() => {
    if (scrollToOffset !== undefined && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollToOffset, behavior: 'smooth' });
    }
  }, [scrollToOffset]);

  // Column adjustment handler with cooldown
  const lastChangeTime = useRef(0);
  const COOLDOWN_MS = 250;

  const adjustColumns = useCallback((delta: number) => {
    const now = Date.now();
    if (lastChangeTime.current > 0 && now - lastChangeTime.current < COOLDOWN_MS) {
      return;
    }

    setColumns((c) => {
      const newCols = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, c + delta));
      if (newCols !== c) {
        lastChangeTime.current = now;
        onColumnsChange?.(newCols);
      }
      return newCols;
    });
  }, [onColumnsChange]);

  // Pinch zoom handling
  const wheelAccumulator = useRef(0);
  const WHEEL_THRESHOLD = 10;
  const pinchAccumulator = useRef(0);
  const PINCH_THRESHOLD = 0.08;

  useGesture(
    {
      onPinch: ({ direction: [dir], first }) => {
        if (first) pinchAccumulator.current = 0;
        pinchAccumulator.current += dir * 0.02;

        if (pinchAccumulator.current >= PINCH_THRESHOLD && columns > MIN_COLUMNS) {
          adjustColumns(-1);
          pinchAccumulator.current = 0;
        } else if (pinchAccumulator.current <= -PINCH_THRESHOLD && columns < MAX_COLUMNS) {
          adjustColumns(1);
          pinchAccumulator.current = 0;
        }
      },
      onWheel: ({ event, delta: [, dy], ctrlKey, metaKey }) => {
        if (ctrlKey || metaKey) {
          event.preventDefault();
          event.stopPropagation();

          wheelAccumulator.current += dy;

          if (wheelAccumulator.current >= WHEEL_THRESHOLD && columns < MAX_COLUMNS) {
            adjustColumns(1);
            wheelAccumulator.current = 0;
          } else if (wheelAccumulator.current <= -WHEEL_THRESHOLD && columns > MIN_COLUMNS) {
            adjustColumns(-1);
            wheelAccumulator.current = 0;
          }
        } else {
          wheelAccumulator.current = 0;
        }
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0.5, max: 3 }, rubberband: true },
    }
  );

  return (
    <div
      ref={scrollRef}
      className="w-full h-full overflow-y-auto overflow-x-hidden"
      style={{
        touchAction: 'pan-y',
        // Use spacing value for edge padding to match item gaps
        paddingLeft: `calc(16px + env(safe-area-inset-left))`,
        paddingRight: `calc(16px + env(safe-area-inset-right))`,
        paddingTop: paddingTop,
        paddingBottom: paddingBottom,
        // Reserve scrollbar space on both edges for symmetry
        scrollbarGutter: 'stable both-edges',
      }}
    >
      <div
        ref={containerRef}
        className="w-full relative touch-pan-y"
        style={{
          height: totalHeight,
          transition: `height ${TRANSITION_DURATION} ease-out`,
        }}
      >
        {layout.map(({ item, x, y, width, height, globalIndex }) => {
          // Only render if item is in visible range (simple virtualization)
          // Using a larger buffer for smooth scrolling
          const scrollTop = scrollRef.current?.scrollTop ?? 0;
          const viewportHeight = scrollRef.current?.clientHeight ?? 800;
          const buffer = viewportHeight * 2;
          const isVisible = y + height >= scrollTop - buffer && y <= scrollTop + viewportHeight + buffer;

          if (!isVisible && layout.length > 50) {
            // Return placeholder for non-visible items in large lists
            return null;
          }

          return (
            <div
              key={item.id}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                width,
                height,
                transform: `translate3d(${x}px, ${y}px, 0)`,
                transition: `transform ${TRANSITION_DURATION} ease-out, width ${TRANSITION_DURATION} ease-out, height ${TRANSITION_DURATION} ease-out`,
              }}
            >
              <GridItem
                item={item}
                onClick={() => onItemClick?.(globalIndex)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoized grid item
 */
const GridItem = memo(function GridItem({
  item,
  onClick
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  if (item.mediaType === 'audio') {
    return (
      <div
        className="w-full h-full bg-muted/30 border border-border flex items-center justify-center group hover:bg-muted/50 cursor-pointer overflow-hidden transition-colors"
        onClick={onClick}
      >
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-primary/10 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
            <AudioLinesIcon className="w-6 h-6 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground truncate max-w-[100px] block">
            {item.alt}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative cursor-pointer overflow-hidden group bg-muted"
      onClick={onClick}
    >
      {item.src ? (
        <img
          src={item.src}
          alt={item.alt}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="w-full h-full bg-muted animate-pulse absolute inset-0" />
      )}
    </div>
  );
});

// Re-export for backwards compatibility
export { VirtualizedMasonryGrid as MasonryGrid };
