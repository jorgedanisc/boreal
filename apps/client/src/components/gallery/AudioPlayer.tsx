import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Play, Pause, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAudio } from '@/lib/vault';

interface AudioPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  audioId: string;
  filename: string;
}

/**
 * Audio player modal that fetches and plays audio on demand
 * Cost-efficient: only fetches from S3 when user clicks play
 */
export function AudioPlayer({ isOpen, onClose, audioId, filename }: AudioPlayerProps) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  // Reference to audio element
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // Fetch audio on first play
  const loadAudio = useCallback(async () => {
    if (audioSrc) return; // Already loaded

    setIsLoading(true);
    setError(null);

    try {
      const base64 = await getAudio(audioId);
      console.log('Audio base64 fetched, length:', base64.length);
      // Opus audio in Ogg container
      setAudioSrc(`data:audio/ogg;base64,${base64}`);
    } catch (e) {
      console.error('Failed to load audio:', e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [audioId, audioSrc]);

  // Play/pause toggle
  const togglePlay = useCallback(async () => {
    if (!audioSrc) {
      await loadAudio();
      return;
    }

    if (audioEl) {
      if (isPlaying) {
        audioEl.pause();
      } else {
        audioEl.play().catch(e => console.error('Play failed:', e));
      }
    }
  }, [audioSrc, audioEl, isPlaying, loadAudio]);

  // Auto-play when audio loads
  useEffect(() => {
    if (audioSrc && audioEl && !isPlaying) {
      console.log('Auto-playing audio...');
      audioEl.play().catch(e => console.error('Auto-play failed:', e));
    }
  }, [audioSrc, audioEl]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setAudioSrc(null);
      setIsPlaying(false);
      setProgress(0);
      setDuration(0);
      setError(null);
    }
  }, [isOpen]);

  // Format time as mm:ss
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-card rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold truncate pr-4">{filename}</h2>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Waveform Placeholder */}
            <div className="bg-muted/30 rounded-lg p-8 mb-6 flex items-center justify-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="text-destructive text-sm mb-4 text-center">
                {error}
              </div>
            )}

            {/* Progress */}
            <div className="mb-4">
              <div className="bg-muted rounded-full h-1.5 overflow-hidden">
                <motion.div
                  className="bg-primary h-full"
                  style={{ width: `${(progress / duration) * 100 || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex justify-center">
              <Button
                size="lg"
                variant="default"
                className="w-16 h-16 rounded-full"
                onClick={togglePlay}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-8 h-8" />
                ) : (
                  <Play className="w-8 h-8 ml-1" />
                )}
              </Button>
            </div>

            {/* Hidden audio element */}
            {audioSrc && (
              <audio
                ref={(el) => setAudioEl(el)}
                src={audioSrc}
                onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
