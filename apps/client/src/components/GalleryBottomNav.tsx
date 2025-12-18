import { useNavigate } from '@tanstack/react-router';
import { Sparkles, Image as ImageIcon, Map as MapIcon } from 'lucide-react';
import { SegmentedControl } from './ui/SegmentedControl';

interface GalleryBottomNavProps {
  currentView: 'gallery' | 'memories' | 'map';
}

export function GalleryBottomNav({ currentView }: GalleryBottomNavProps) {
  const navigate = useNavigate();

  return (
    <div
      className="backdrop-blur-2xl border border-white/10 shadow-2xl rounded-full p-1.5 h-14 bg-secondary/60 min-w-[280px] max-w-[90vw]"
    >
      <SegmentedControl
        value={currentView}
        onChange={(v) => {
          if (v === 'memories') {
            navigate({ to: '/gallery/memories' });
          } else if (v === 'gallery') {
            navigate({ to: '/gallery' });
          } else if (v === 'map') {
            // navigate({ to: '/gallery/map' }); // Future
          }
        }}
        items={[
          {
            value: 'memories',
            label: 'Memories',
            icon: <Sparkles className="w-5 h-5 mb-0.5" />
          },
          {
            value: 'gallery',
            label: 'Library',
            icon: <ImageIcon className="w-5 h-5 mb-0.5" />
          },
          {
            value: 'map',
            label: 'Map',
            icon: <MapIcon className="w-5 h-5 mb-0.5" />
          },
        ]}
      />
    </div>
  );
}
