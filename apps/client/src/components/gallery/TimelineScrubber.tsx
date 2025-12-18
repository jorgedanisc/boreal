import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface TimelineDate {
  label: string; // e.g., "Dec 2024", "Nov 2024"
  offsetY: number; // Scroll offset for this date section
  itemCount: number;
}

interface TimelineScrubberProps {
  dates: TimelineDate[];
  currentScrollY: number;
  totalHeight: number;
  onScrollToOffset: (offset: number) => void;
  side?: 'left' | 'right' | 'both';
}

/**
 * Timeline Scrubber Component
 * 
 * A compact timeline that appears when user drags from the edge of the gallery.
 * Shows date labels and allows fast navigation through the photo collection.
 */
export function TimelineScrubber({
  dates,
  currentScrollY,
  totalHeight,
  onScrollToOffset,
  side = 'both',
}: TimelineScrubberProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const containerHeight = useRef(0);

  // Calculate current date based on scroll position
  const currentDate = useMemo(() => {
    if (dates.length === 0) return null;

    // Find the date section we're currently in
    for (let i = dates.length - 1; i >= 0; i--) {
      if (currentScrollY >= dates[i].offsetY) {
        return dates[i];
      }
    }
    return dates[0];
  }, [dates, currentScrollY]);

  // Handle drag to scroll
  const handleDrag = useCallback((y: number, height: number) => {
    if (dates.length === 0 || totalHeight === 0) return;

    // Calculate progress (0-1) based on Y position in scrubber
    const progress = Math.max(0, Math.min(1, y / height));

    // Map to scroll offset
    const targetOffset = progress * totalHeight;

    // Find the date at this offset
    let nearestDate = dates[0];
    for (let i = dates.length - 1; i >= 0; i--) {
      if (targetOffset >= dates[i].offsetY) {
        nearestDate = dates[i];
        break;
      }
    }

    setActiveLabel(nearestDate.label);
    onScrollToOffset(targetOffset);
  }, [dates, totalHeight, onScrollToOffset]);

  // Gesture handling
  useGesture(
    {
      onDragStart: ({ event }) => {
        event.preventDefault();
        setIsDragging(true);
        containerHeight.current = scrubberRef.current?.clientHeight || 400;
      },
      onDrag: ({ xy: [, y], event }) => {
        event.preventDefault();
        const rect = scrubberRef.current?.getBoundingClientRect();
        if (rect) {
          const relativeY = y - rect.top;
          handleDrag(relativeY, rect.height);
        }
      },
      onDragEnd: () => {
        setIsDragging(false);
        setActiveLabel(null);
      },
    },
    {
      target: scrubberRef,
      drag: {
        filterTaps: true,
        preventDefault: true,
      },
    }
  );

  // Update on external scroll
  useEffect(() => {
    if (!isDragging && currentDate) {
      setActiveLabel(null);
    }
  }, [currentScrollY, isDragging, currentDate]);

  if (dates.length === 0) return null;

  const renderScrubber = (position: 'left' | 'right') => (
    <div
      key={position}
      className={cn(
        'fixed top-0 bottom-0 w-8 z-50 flex items-center justify-center',
        'transition-opacity duration-200',
        position === 'left' ? 'left-0' : 'right-0',
        isDragging ? 'opacity-100' : 'opacity-0 hover:opacity-50'
      )}
    >
      {/* Touch Zone */}
      <div
        ref={position === 'right' ? scrubberRef : undefined}
        className={cn(
          'absolute inset-0 cursor-grab active:cursor-grabbing',
          isDragging && 'bg-primary/5'
        )}
      />

      {/* Timeline Track */}
      <div className="relative h-[80%] w-1 bg-muted/30 rounded-full overflow-hidden">
        {/* Progress Indicator */}
        <motion.div
          className="absolute top-0 left-0 right-0 bg-primary/40 rounded-full"
          style={{
            height: `${(currentScrollY / Math.max(1, totalHeight)) * 100}%`,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />

        {/* Date Markers */}
        {dates.map((date, _index) => {
          const position = (date.offsetY / Math.max(1, totalHeight)) * 100;
          return (
            <div
              key={date.label}
              className="absolute left-0 right-0 h-0.5 bg-border/50"
              style={{ top: `${position}%` }}
              title={date.label}
            />
          );
        })}
      </div>

      {/* Active Date Label */}
      <AnimatePresence>
        {isDragging && activeLabel && (
          <motion.div
            initial={{ opacity: 0, x: position === 'right' ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: position === 'right' ? 20 : -20 }}
            className={cn(
              'absolute px-3 py-2 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg',
              'text-sm font-medium whitespace-nowrap',
              position === 'right' ? 'right-10' : 'left-10'
            )}
          >
            {activeLabel}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {(side === 'left' || side === 'both') && renderScrubber('left')}
      {(side === 'right' || side === 'both') && renderScrubber('right')}
    </>
  );
}

/**
 * Helper function to group photos by month/year for timeline dates
 */
export function groupPhotosByDate(
  photos: Array<{ capturedAt?: string; createdAt?: string }>,
  getItemOffset: (index: number) => number
): TimelineDate[] {
  const groups = new Map<string, { count: number; firstIndex: number }>();

  photos.forEach((photo, index) => {
    const dateStr = photo.capturedAt || photo.createdAt;
    if (!dateStr) return;

    try {
      const date = new Date(dateStr);
      const label = date.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });

      if (!groups.has(label)) {
        groups.set(label, { count: 1, firstIndex: index });
      } else {
        const group = groups.get(label)!;
        group.count++;
      }
    } catch {
      // Invalid date, skip
    }
  });

  const dates: TimelineDate[] = [];
  groups.forEach((group, label) => {
    dates.push({
      label,
      offsetY: getItemOffset(group.firstIndex),
      itemCount: group.count,
    });
  });

  // Sort by offset (chronological order)
  dates.sort((a, b) => a.offsetY - b.offsetY);

  return dates;
}
