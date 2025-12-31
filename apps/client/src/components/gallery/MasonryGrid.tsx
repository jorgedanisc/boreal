import { useGesture } from '@use-gesture/react';
import { AudioLinesIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';

export interface MediaItem {
  id: string;
  src: string; // Thumbnail URL (base64 or empty for audio, or empty for header)
  width: number;
  height: number;
  alt: string;
  mediaType: 'image' | 'video' | 'audio' | 'header';
  capturedAt?: string; // ISO date string for timeline grouping
  isUnknown?: boolean;
}

export interface LayoutItem {
  item: MediaItem;
  x: number;
  y: number;
  width: number;
  height: number;
  globalIndex: number;
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

/**
 * Memoized grid item
 */
const GridItem = memo(function GridItem({
  item,
  renderedWidth,
  onClick
}: {
  item: MediaItem;
  renderedWidth: number;
  onClick: () => void;
}) {
  if (item.mediaType === 'header') {
    return (
      <div className="w-full h-full flex items-end pb-2 px-2" onClick={onClick}>
        <h2 className="text-xl">
          {item.alt}
        </h2>
      </div>
    );
  }

  if (item.mediaType === 'audio') {
    // Responsive check: if small, show simplified view
    const isSmall = renderedWidth < 120;
    return (
      <div
        className="w-full h-full bg-muted/30 border border-border flex items-center justify-center group hover:bg-muted/50 cursor-pointer overflow-hidden transition-colors rounded-md"
        onClick={onClick}
      >
        <div className="text-center p-2 w-full flex flex-col items-center justify-center h-full">
          <div className={`bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform rounded-full ${isSmall ? 'w-10 h-10' : 'w-12 h-12 mb-2'}`}>
            <AudioLinesIcon className={`${isSmall ? 'w-5 h-5' : 'w-6 h-6'} text-primary`} />
          </div>
          {!isSmall && (
            <span className="text-xs font-medium text-muted-foreground truncate w-full block px-1">
              {item.alt}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative cursor-pointer overflow-hidden group bg-muted rounded-md"
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

    const finalizeRow = (rowItems: typeof currentRow, isLastRow: boolean) => {
      if (rowItems.length === 0) return;

      if (isLastRow) {
        // Handle remaining items (Last row) - Align left, don't stretch
        let currentX = 0;
        rowItems.forEach((rowItem) => {
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
      } else {
        // Finalize full row
        const rowGap = (rowItems.length - 1) * spacing;
        const sumRatios = rowItems.reduce((sum, it) => sum + it.ratio, 0);
        const finalRowHeight = (containerWidth - rowGap) / sumRatios;

        let currentX = 0;
        rowItems.forEach((rowItem) => {
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
      }
    };

    items.forEach((item, globalIndex) => {
      // HEADER HANDLING
      if (item.mediaType === 'header') {
        // 1. Finalize current row if any
        finalizeRow(currentRow, true); // Treat as last row (left align) to avoid stretching few items above header
        currentRow = [];
        currentRowWidth = 0;

        // 2. Add Header Item
        const headerHeight = 60; // Fixed header height
        fullLayout.push({
          item,
          x: 0,
          y: currentY,
          width: containerWidth,
          height: headerHeight,
          globalIndex
        });
        currentY += headerHeight + spacing;
        return;
      }

      // NORMAL ITEM HANDLING
      const w = item.width > 0 ? item.width : 1;
      const h = item.height > 0 ? item.height : 1;
      const ratio = item.mediaType === 'audio' ? 1 : (w / h);

      const widthAtTarget = targetRowHeight * ratio;

      currentRow.push({ item, globalIndex, ratio, widthAtTarget });
      currentRowWidth += widthAtTarget;

      // Check if we interpret the row as full
      const rowGap = (currentRow.length - 1) * spacing;
      if (currentRowWidth + rowGap >= containerWidth) {
        finalizeRow(currentRow, false);
        currentRow = [];
        currentRowWidth = 0;
      }
    });

    // Handle remaining items (Last row)
    finalizeRow(currentRow, true);

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

  /* 
   * Virtualization state
   * We need to track scrollTop in state to trigger re-renders as the user scrolls.
   * Without this, the component only re-renders on prop changes/resize, but not on scroll,
   * causing items to remain "invisible" (null) as you scroll down.
   */
  const [scrollTop, setScrollTop] = useState(0);

  // Notify parent of scroll position changes for timeline sync
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      // Update local state for virtualization
      setScrollTop(scrollElement.scrollTop);

      // Notify parent if needed
      if (onScrollPositionChange) {
        onScrollPositionChange(scrollElement.scrollTop, totalHeight);
      }
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
          // note: we use 'scrollTop' state here instead of ref.current.scrollTop to ensure reactivity
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
                renderedWidth={width}
                onClick={() => onItemClick?.(globalIndex)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-export for backwards compatibility
export { VirtualizedMasonryGrid as MasonryGrid };
