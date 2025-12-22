import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ApertureIcon, FilmIcon } from 'lucide-react';
import { SegmentedControl } from './ui/SegmentedControl';

interface GalleryBottomNavProps {
  currentView: 'gallery' | 'memories' | 'map';
}

export function GalleryBottomNav({ currentView }: GalleryBottomNavProps) {
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        buttonVariants({ variant: "glass" }),
        "rounded-full! p-1 h-14 min-w-[180px] max-w-[90vw] hover:bg-secondary/60"
      )}
    >
      <SegmentedControl
        value={currentView}
        onChange={(v) => {
          if (v === 'memories') {
            navigate({ to: '/gallery/memories' });
          } else if (v === 'gallery') {
            navigate({ to: '/gallery' });
          }
        }}
        items={[
          {
            value: 'memories',
            label: 'Memories',
            icon: <FilmIcon className="size-5 mb-0.5" />
          },
          {
            value: 'gallery',
            label: 'Library',
            icon: <ApertureIcon className="size-5 mb-0.5" />
          }
        ]}
      />
    </div>
  );
}
