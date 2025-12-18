import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useGalleryLayout } from '@/routes/gallery';
import { BentoMediaGrid } from '@/components/memories/BentoMediaGrid';

interface Memory {
  id: string;
  title: string;
  text_content: string;
  date: string;
  created_at: string;
  updated_at: string;
  media_ids: string[];
}

function MemoryCard({ memory, onClick }: { memory: Memory; onClick: () => void }) {
  // Removed formattedDate and footer as requested
  return (
    <div
      onClick={onClick}
      className="bg-card rounded-3xl overflow-hidden shadow-sm border border-border/50 hover:shadow-md transition-shadow cursor-pointer group flex flex-col"
    >
      {/* Media Grid Top */}
      <BentoMediaGrid mediaIds={memory.media_ids} />

      {/* Content */}
      <div className="p-4 flex flex-col gap-2">
        <h3 className="font-bold text-lg leading-tight text-foreground">{memory.title}</h3>
        {memory.text_content && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {memory.text_content}
          </p>
        )}
      </div>
    </div>
  );
}

export default function MemoriesPage() {
  const navigate = useNavigate();
  const { setSubtitle } = useGalleryLayout();
  const [memories, setMemories] = useState<Memory[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadMemories = async () => {
    try {
      const loaded = await invoke<Memory[]>('get_memories');
      // Sort by date descending
      loaded.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setMemories(loaded);
    } catch (error) {
      console.error("Failed to load memories:", error);
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

  // Reload memories when a new one is saved (triggered by context)
  useEffect(() => {
    // Listen for custom event to refresh memories
    const handleMemorySaved = () => loadMemories();
    window.addEventListener('memory-saved', handleMemorySaved);
    return () => window.removeEventListener('memory-saved', handleMemorySaved);
  }, []);

  // Update subtitle based on scroll position
  const updateSubtitleFromScroll = useCallback(() => {
    if (!scrollRef.current || memories.length === 0) {
      setSubtitle('Timeline');
      return;
    }

    const scrollTop = scrollRef.current.scrollTop;
    const viewportTop = scrollTop + 150; // Account for header

    // Find the first visible memory card
    let closestMemory: Memory | null = null;
    let closestDistance = Infinity;

    cardRefs.current.forEach((element, id) => {
      if (element) {
        const rect = element.getBoundingClientRect();
        const elementTop = rect.top + scrollTop - scrollRef.current!.getBoundingClientRect().top;
        const distance = Math.abs(elementTop - viewportTop);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestMemory = memories.find(m => m.id === id) || null;
        }
      }
    });

    if (closestMemory) {
      // @ts-ignore - Type checking issue
      const date = new Date(closestMemory.date);
      const formatted = date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      setSubtitle(formatted);
    } else {
      setSubtitle('Timeline');
    }
  }, [memories, setSubtitle]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener('scroll', updateSubtitleFromScroll, { passive: true });
    // Initial update
    updateSubtitleFromScroll();

    return () => scrollElement.removeEventListener('scroll', updateSubtitleFromScroll);
  }, [updateSubtitleFromScroll]);

  const setCardRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      cardRefs.current.set(id, element);
    } else {
      cardRefs.current.delete(id);
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden pt-[120px] pb-[100px] px-4"
      style={{ scrollbarGutter: 'stable both-edges' }}
    >
      {memories.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
            <Sparkles className="w-8 h-8" />
          </div>
          <p>No memories yet. Start writing one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 mx-auto max-w-[2000px]">
          {memories.map(memory => (
            <div
              key={memory.id}
              ref={(el) => setCardRef(memory.id, el)}
            >
              <MemoryCard
                memory={memory}
                onClick={() => navigate({ to: '/gallery/memories/$id', params: { id: memory.id } })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
