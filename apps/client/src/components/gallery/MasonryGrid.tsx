import { useState, useRef, useMemo, useCallback, memo } from 'react';
import { useGesture } from '@use-gesture/react';
import { Music } from 'lucide-react';
import { useResizeObserver } from 'usehooks-ts';

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

// Column limits
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;

// CSS transition duration for smooth zooming
const TRANSITION_DURATION = '0.3s';

/**
 * Custom masonry grid with ABSOLUTE POSITIONING
 * 
 * CORE ARCHITECTURE CHANGE:
 * Previously, we used separate arrays for each column. This caused React to unmount/remount
 * items when they moved between columns during zoom, causing "blinking".
 * 
 * NEW APPROACH:
 * - Flat list of items in a single relative container
 * - Absolute positioning (transform: translate3d) for every item
 * - Memoized layout calculation (x,y coordinates)
 * - CSS transitions for smooth movement
 * - Items NEVER unmount during zoom, eliminating blink completely
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
  const { width: containerWidth = 0 } = useResizeObserver({
    ref: containerRef,
    box: 'border-box',
  });

  /**
   * Layout Calculation Engine
   * Computes the exact (x, y) coordinates for every item based on current column count.
   * Returns:
   *  - layout: Array of position data { id, x, y, width, height }
   *  - containerHeight: Total height of the grid
   */
  const { layout, containerHeight } = useMemo(() => {
    // Avoid division by zero
    if (!containerWidth || columns === 0) return { layout: [], containerHeight: 0 };

    const colWidth = (containerWidth - (columns - 1) * spacing) / columns;
    const colHeights = Array(columns).fill(0);

    // Position map for fast lookup if needed, or just map original items to positions
    const newLayout = items.map((item) => {
      // Find shortest column
      const colIndex = colHeights.indexOf(Math.min(...colHeights));

      const x = colIndex * (colWidth + spacing);
      const y = colHeights[colIndex];

      // Calculate aspect-ratio based height
      const w = item.width > 0 ? item.width : 1;
      const h = item.height > 0 ? item.height : 1;
      // For audio, force square. For others, maintain aspect ratio.
      const ratio = item.mediaType === 'audio' ? 1 : (w / h);
      const itemHeight = colWidth / ratio;

      // Update column height
      colHeights[colIndex] += itemHeight + spacing;

      return {
        item,
        x,
        y,
        width: colWidth,
        height: itemHeight,
      };
    });

    return {
      layout: newLayout,
      containerHeight: Math.max(...colHeights)
    };
  }, [items, columns, containerWidth, spacing]);


  // Column adjustment handler with cooldown for rate-limiting
  const lastChangeTime = useRef(0);
  const COOLDOWN_MS = 250; // Minimum time between column changes

  const adjustColumns = useCallback((delta: number) => {
    const now = Date.now();
    // Enforce cooldown between changes (but allow first change instantly)
    if (lastChangeTime.current > 0 && now - lastChangeTime.current < COOLDOWN_MS) {
      return; // Skip - too soon since last change
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

  // Track accumulated wheel delta for smooth zooming
  const wheelAccumulator = useRef(0);
  const WHEEL_THRESHOLD = 10; // Very low for instant start

  // Track pinch scale for more reliable detection
  const pinchAccumulator = useRef(0);
  const PINCH_THRESHOLD = 0.08; // Accumulated scale change needed

  useGesture(
    {
      // onPinch handles actual touch pinch (mobile/tablets) and some trackpads
      onPinch: ({ offset: [scale], direction: [dir], first }) => {
        // Reset accumulator on first touch
        if (first) {
          pinchAccumulator.current = 0;
        }

        // Accumulate scale change based on direction
        // dir > 0 = zooming in (pinch out), dir < 0 = zooming out (pinch in)
        pinchAccumulator.current += dir * 0.02;

        if (pinchAccumulator.current >= PINCH_THRESHOLD && columns > MIN_COLUMNS) {
          adjustColumns(-1); // Zoom in = fewer columns
          pinchAccumulator.current = 0;
        } else if (pinchAccumulator.current <= -PINCH_THRESHOLD && columns < MAX_COLUMNS) {
          adjustColumns(1); // Zoom out = more columns
          pinchAccumulator.current = 0;
        }
      },
      // onWheel with ctrlKey/metaKey handles trackpad pinch on macOS
      // (macOS sends trackpad pinch as wheel events with ctrlKey: true)
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
      // Enable pinch gesture detection
      pinch: {
        scaleBounds: { min: 0.5, max: 3 },
        rubberband: true,
      },
    }
  );

  // Find global index for an item
  const getGlobalIndex = useCallback((item: MediaItem) => {
    return items.findIndex((i) => i.id === item.id);
  }, [items]);

  return (
    <div
      ref={containerRef}
      className="w-full relative touch-pan-y overflow-hidden"
      style={{
        touchAction: 'pan-y',
        height: containerHeight, // Explicit height from layout calc
        transition: `height ${TRANSITION_DURATION} ease-out` // Smooth container height change
      }}
    >
      {layout.map(({ item, x, y, width, height }) => (
        <div
          key={item.id}
          className="absolute top-0 left-0 will-change-transform"
          style={{
            width: width,
            height: height,
            transform: `translate3d(${x}px, ${y}px, 0)`,
            // Fluid Layout Transitions
            transition: `transform ${TRANSITION_DURATION} ease-out, width ${TRANSITION_DURATION} ease-out, height ${TRANSITION_DURATION} ease-out`
          }}
        >
          <GridItem
            item={item}
            onClick={() => onItemClick?.(getGlobalIndex(item))}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Memoized grid item.
 * NOTE: Since we control width/height in parent container style,
 * this component just fills 100% of the parent absolute div.
 */
const GridItem = memo(function GridItem({
  item,
  onClick
}: {
  item: MediaItem;
  onClick: () => void;
}) {

  // Audio: show music icon placeholder
  if (item.mediaType === 'audio') {
    return (
      <div
        className="w-full h-full bg-muted/30 border border-border flex items-center justify-center group hover:bg-muted/50 cursor-pointer overflow-hidden transition-colors"
        onClick={onClick}
      >
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-primary/10 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
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
