import { GalleryBottomNav } from '@/components/GalleryBottomNav';
import { MemoryEditor } from '@/components/memories/MemoryEditor';
import { Button } from '@/components/ui/button';

import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Memory {
  id: string;
  title: string;
  text_content: string;
  date: string;
  created_at: string;
  updated_at: string;
  media_ids: string[];
}

// Placeholder MemoryCard for now, will refine in next step
function MemoryCard({ memory }: { memory: Memory }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (memory.media_ids.length > 0) {
      invoke<string>('get_thumbnail', { id: memory.media_ids[0] })
        .then(setThumbnail)
        .catch(console.error);
    }
  }, [memory]);

  return (
    <div className="bg-card rounded-xl overflow-hidden shadow-sm border border-border/50 hover:shadow-md transition-shadow cursor-pointer group">
      {memory.media_ids.length > 0 && (
        <div className="aspect-4/3 bg-muted relative overflow-hidden">
          {thumbnail ? (
            <img src={`data:image/webp;base64,${thumbnail}`} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          ) : (
            <div className="w-full h-full animate-pulse bg-muted" />
          )}
        </div>
      )}
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{new Date(memory.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>
        <h3 className="font-bold text-lg leading-tight">{memory.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
          {memory.text_content}
        </p>
      </div>
    </div>
  );
}

export default function MemoriesPage() {
  const navigate = useNavigate();
  // const { getCompletedCount } = useUploadStore(); // Unused
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const loadMemories = async () => {
    try {
      const loaded = await invoke<Memory[]>('get_memories');
      setMemories(loaded);
    } catch (error) {
      console.error("Failed to load memories:", error);
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

  return (
    <div className="text-foreground flex flex-col h-screen bg-background relative overflow-hidden">
      {/* Header - Reuse style from Gallery */}
      <header
        className="fixed top-0 left-0 right-0 z-30 pointer-events-none"
        style={{
          paddingTop: "32px", // Fixed desktop padding for now
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, oklch(18.971% 0.00816 296.997) 0%, oklch(18.971% 0.00816 296.997 / 0.9) 50%, oklch(18.971% 0.00816 296.997 / 0) 100%)',
          }}
        />
        <div className="relative flex items-start justify-between p-4 pointer-events-auto">
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate({ to: "/" })}
                className="shrink-0 -ml-2 h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-bold tracking-tight px-2">
                Memories
              </h1>
            </div>
            <p className="text-sm font-medium text-muted-foreground/70 ml-10">
              Reflections
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => setIsEditorOpen(true)}
              className="rounded-full px-5 font-semibold bg-foreground text-background hover:bg-foreground/90 transition-colors shadow-lg"
            >
              New Entry
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="absolute inset-0 overflow-y-auto overflow-x-hidden pt-[120px] pb-[100px] px-4"
        style={{
          scrollbarGutter: 'stable both-edges',
        }}
      >
        {memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8" />
            </div>
            <p>No memories yet. Start writing one!</p>
          </div>
        ) : (
          <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4 mx-auto max-w-[1600px]">
            {memories.map(memory => (
              <div key={memory.id} className="break-inside-avoid">
                <MemoryCard memory={memory} />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <GalleryBottomNav currentView="memories" />

      <MemoryEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSave={loadMemories}
      />
    </div>
  );
}
