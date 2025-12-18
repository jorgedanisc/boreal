import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import {
  motion,
  PanInfo,
  useAnimation,
  useMotionValue,
} from "motion/react";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const segmentedControlVariants = cva(
  "",
  {
    variants: {
      size: {
        default: "rounded-lg",
        sm: "rounded-md",
        lg: "rounded-xl",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

export interface SegmentedControlItem<T> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T> extends VariantProps<typeof segmentedControlVariants> {
  items: SegmentedControlItem<T>[];
  value: T;
  verbose?: boolean;
  onChange: (value: T) => void;
  className?: string;
  handleClassName?: string;
}

export function SegmentedControl<T extends string | number>({
  items,
  value,
  verbose = true,
  onChange,
  className,
  handleClassName,
  size,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const controls = useAnimation();
  const x = useMotionValue(0);

  const activeIndex = items.findIndex((item) => item.value === value);
  const safeActiveIndex = activeIndex === -1 ? 0 : activeIndex;
  const itemWidth = containerWidth > 0 ? containerWidth / items.length : 0;
  const activeX = safeActiveIndex * itemWidth;

  // Helper function to find nearest non-disabled item index
  const findNearestEnabledIndex = (targetIndex: number): number => {
    if (!items[targetIndex]?.disabled) {
      return targetIndex;
    }

    // Search for nearest enabled item
    let leftIndex = targetIndex - 1;
    let rightIndex = targetIndex + 1;

    while (leftIndex >= 0 || rightIndex < items.length) {
      if (leftIndex >= 0 && !items[leftIndex]?.disabled) {
        return leftIndex;
      }
      if (rightIndex < items.length && !items[rightIndex]?.disabled) {
        return rightIndex;
      }
      leftIndex--;
      rightIndex++;
    }

    // Fallback to current active index if all items are disabled (shouldn't happen)
    return safeActiveIndex;
  };

  useLayoutEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", updateWidth);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (containerWidth > 0) {
      if (!isInitialized) {
        x.set(activeX);
        setIsInitialized(true);
      } else if (!isDragging) {
        controls.start({
          x: activeX,
          transition: {
            type: "tween",
            duration: 0.20,
            ease: [0.65, 0, 0.35, 1],
          },
        });
      }
    }
  }, [activeX, containerWidth, controls, isDragging, x, isInitialized]);

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDrag = (_: any, info: PanInfo) => {
    const currentX = x.get();
    // Use center of handle for more accurate detection
    const centerX = currentX + itemWidth / 2;
    const hoveredIndex = Math.floor(centerX / itemWidth);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, hoveredIndex));
    const enabledIndex = findNearestEnabledIndex(clampedIndex);

    setDragTargetIndex(enabledIndex);
  };

  const handleDragEnd = (_: any, info: PanInfo) => {
    setIsDragging(false);
    setDragTargetIndex(null);

    const dropX = x.get();
    // Use center of handle for more accurate drop detection
    const centerX = dropX + itemWidth / 2;
    let targetIndex = Math.floor(centerX / itemWidth);
    targetIndex = Math.max(0, Math.min(items.length - 1, targetIndex));

    // Find nearest enabled item
    targetIndex = findNearestEnabledIndex(targetIndex);

    const newValue = items[targetIndex].value;

    // Always call onChange, even if value is the same
    // This allows navigation to trigger even when clicking the already-active tab
    onChange(newValue);

    // Animate to the target position
    controls.start({
      x: targetIndex * itemWidth,
      transition: {
        type: "tween",
        duration: 0.10,
        ease: [0.65, 0, 0.35, 1],
      },
    });
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-full w-full select-none items-center justify-between",
        className
      )}
    >
      <div className="relative flex h-full w-full">
        {items.map((item, index) => {
          const isActive = item.value === value;
          const isDragTarget = isDragging && dragTargetIndex === index;
          const isDisabled = item.disabled ?? false;

          return (
            <button
              key={String(item.value)}
              type="button"
              onClick={() => !isDisabled && onChange(item.value)}
              disabled={isDisabled}
              className={cn(
                "group flex flex-col items-center pb-0.5 pt-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-all duration-200 ease-out rounded-full relative", // Removed z-index to maintain button interaction
                !isActive && !isDisabled && "hover:bg-muted/50",
                isDragging && "pointer-events-none",
                !verbose ? "justify-center pt-0.5" : "justify-between",
                isDisabled && "cursor-not-allowed opacity-50",
              )}
              style={{ width: `${100 / items.length}%` }}
            >
              <span
                className={cn(
                  "transition-colors duration-150",
                  "pointer-events-none relative z-40",
                  isActive
                    ? "text-primary-foreground"
                    : isDragTarget
                      ? "text-primary-foreground/90"
                      : isDisabled
                        ? "opacity-50"
                        : "text-muted-foreground group-hover:text-foreground"
                )}
              >
                {item.icon}
              </span>

              {
                verbose && (
                  <span
                    className={cn(
                      "text-[10px] font-medium tracking-wide transition-colors duration-150",
                      "pointer-events-none relative z-40",
                      isActive
                        ? "text-primary-foreground"
                        : isDragTarget
                          ? "text-primary-foreground/90"
                          : isDisabled
                            ? "opacity-50"
                            : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                )
              }
            </button>
          );
        })}
      </div>

      {containerWidth > 0 && (
        <motion.div
          drag="x"
          dragMomentum={false}
          dragElastic={0.05}
          dragTransition={{
            power: 0.2,
            timeConstant: 150
          }}
          animate={controls}
          style={{ x, width: itemWidth }}
          dragConstraints={{
            left: 0,
            right: containerWidth - itemWidth,
          }}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onTap={(event, info) => {
            // On tap, always trigger onChange for the current segment
            // This ensures navigation happens even when tapping the already-active segment
            const currentX = x.get();
            const centerX = currentX + itemWidth / 2;
            let targetIndex = Math.floor(centerX / itemWidth);
            targetIndex = Math.max(0, Math.min(items.length - 1, targetIndex));
            targetIndex = findNearestEnabledIndex(targetIndex);
            onChange(items[targetIndex].value);
          }}
          whileDrag={{
            scale: 1.01,
            cursor: "grabbing"
          }}
          className={cn(
            "absolute h-full top-0 left-0 z-20",
            "border-white/10 bg-muted border-2",
            "cursor-grab active:cursor-grabbing touch-none",
            // Extra touch-friendly grab area via internal padding effect
            "before:absolute before:inset-[-8px] before:content-[''] md:before:inset-[-4px]",
            "rounded-full", // Always rounded-full for pill shape
            handleClassName
          )}
        />
      )}
    </div>
  );
}