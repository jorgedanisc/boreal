import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';

import { BentoMediaGrid } from '@/components/memories/BentoMediaGrid';

// Defined Memory Layout
export const Route = createFileRoute('/gallery/memories/$id')({
  component: MemoryDetailsPage,
});

interface Memory {
  id: string;
  title: string;
  text_content: string;
  date: string;
  created_at: string;
  updated_at: string;
  media_ids: string[];
}

function MemoryDetailsPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [memory, setMemory] = useState<Memory | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  useEffect(() => {
    // We need a specific get_memory command or just filter from all for now?
    // Using get_memories and filtering is inefficient but quick for mvp if get_memory doesn't exist.
    // Ideally we add get_memory in backend, but let's see if we can just reuse get_memories for now or add it later.
    // The implementation plan didn't specify get_memory command in rust, so I'll assume we iterate.
    // Wait, create_memory, get_memories, update_memory, delete_memory are the commands.
    // I should probably add `get_memory` to rust or careful filter.
    // For now, I'll filter from get_memories.
    invoke<Memory[]>('get_memories').then(memories => {
      const found = memories.find(m => m.id === id);
      if (found) {
        setMemory(found);
      }
    });
  }, [id]);

  if (!memory) return <div className="p-10 text-center">Loading...</div>;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-foreground">
      <header
        className="sticky top-0 z-10 bg-background/80 backdrop-blur-md p-4 flex items-center gap-4 hidden md:flex"
        style={{ paddingTop: isDesktop ? 'calc(32px + 1rem)' : '1rem' }}
      >
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/gallery/memories' })}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {new Date(memory.date).toLocaleDateString(undefined, { dateStyle: 'long' })}
        </span>
      </header>

      {/* Mobile back button overlay */}
      <div className="md:hidden fixed top-4 left-4 z-20">
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md text-white"
          onClick={() => navigate({ to: '/gallery/memories' })}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="max-w-2xl mx-auto pb-20 space-y-6 md:p-6 md:pt-0">
        {/* Media Grid at Top (Scrollable for all items) */}
        <div className="md:rounded-3xl overflow-hidden">
          <BentoMediaGrid mediaIds={memory.media_ids} scrollable />
        </div>

        <div className="px-6 md:px-0 space-y-6">
          <div className="space-y-2">
            <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground block md:hidden">
              {new Date(memory.date).toLocaleDateString(undefined, { dateStyle: 'long' })}
            </span>
            <h1 className="text-3xl font-bold leading-tight">{memory.title}</h1>
          </div>

          <p className="text-lg leading-relaxed whitespace-pre-wrap text-muted-foreground/90">{memory.text_content}</p>
        </div>
      </div>
    </div>
  );
}
