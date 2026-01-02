import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { checkOriginalStatus, getOriginal, OriginalStatus, requestOriginalRestore } from '@/lib/vault';
import { IconCalendar, IconCircleDashedLetterO, IconCircleLetterO, IconClock, IconDownload, IconInfoCircle, IconInfoCircleFilled, IconLoader, IconMapPin, IconMapPinExclamation, IconX } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { type } from '@tauri-apps/plugin-os';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { PhotoProvider, PhotoSlider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { toast } from 'sonner';

export interface PhotoMetadata {
  id: string;
  filename: string;
  captured_at?: string;
  created_at: string;
  latitude?: number;
  longitude?: number;
  width: number;
  height: number;
  vault_id?: string;
  // Extended Metadata
  make?: string;
  model?: string;
  lens_model?: string;
  iso?: number;
  f_number?: number;
  exposure_time?: string;
  media_type?: 'image' | 'video' | 'audio';
}

interface QuickPhotoSliderProps {
  visible: boolean;
  onClose: () => void;
  index: number;
  onIndexChange: (index: number) => void;
  photos: PhotoMetadata[];
  thumbnails: Record<string, string>; // Map of photo ID to thumbnail src
  onPhotoUpdate?: (id: string, updates: Partial<PhotoMetadata>) => void;
}

interface MetadataPanelProps {
  photo: PhotoMetadata;
  onClose: () => void;
  onUpdate?: (updates: Partial<PhotoMetadata>) => void;
  isDesktop: boolean;
}

function MetadataPanel({ photo, onClose, onUpdate, isDesktop }: MetadataPanelProps) {
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [isAddingDate, setIsAddingDate] = useState(false);
  const [tempLat, setTempLat] = useState('');
  const [tempLng, setTempLng] = useState('');
  const [tempDate, setTempDate] = useState<Date | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const hasLocation = photo.latitude != null && photo.longitude != null;
  const hasDate = !!photo.captured_at;

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const handleSaveLocation = async () => {
    const lat = parseFloat(tempLat);
    const lng = parseFloat(tempLng);
    if (isNaN(lat) || isNaN(lng)) return;

    setIsSaving(true);
    try {
      await invoke('update_photo_metadata', {
        vaultId: photo.vault_id,
        id: photo.id,
        latitude: lat,
        longitude: lng,
      });
      onUpdate?.({ latitude: lat, longitude: lng });
      setIsAddingLocation(false);
    } catch (e) {
      console.error('Failed to update location:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDate = async () => {
    if (!tempDate) return;

    setIsSaving(true);
    try {
      const isoDate = tempDate.toISOString();
      await invoke('update_photo_metadata', {
        vaultId: photo.vault_id,
        id: photo.id,
        capturedAt: isoDate,
      });
      onUpdate?.({ captured_at: isoDate });
      setIsAddingDate(false);
    } catch (e) {
      console.error('Failed to update date:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="absolute bg-background/90 backdrop-blur-xl border border-border/30 overflow-hidden z-50 flex flex-col pointer-events-auto"
      style={{
        right: isDesktop ? '16px' : '0',
        top: isDesktop ? '100px' : '0',
        bottom: isDesktop ? '100px' : '0',
        width: isDesktop ? '320px' : '100%',
        borderRadius: isDesktop ? '16px' : '0',
        paddingTop: isDesktop ? '0' : 'env(safe-area-inset-top)',
        paddingBottom: isDesktop ? '0' : 'env(safe-area-inset-bottom)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        {/* Filename with truncation for title */}
        <h3 className="font-semibold text-sm truncate max-w-[240px]" title={photo.filename}>
          {photo.filename}
        </h3>
        <button onClick={onClose} className="p-1 hover:bg-secondary/50 rounded-lg transition-colors">
          <IconX className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Camera Info Card OR Resolution Card */}
        {(photo.make || photo.model) ? (
          <div className="bg-secondary/50 rounded-xl overflow-hidden backdrop-blur-sm border border">
            {/* Header with Device Name */}
            <div className="bg-white/5 px-4 py-0.5 border-b border-white/10">
              <span className="font-medium text-sm text-foreground">
                {[photo.make, photo.model].filter(Boolean).join(' ')}
              </span>
            </div>

            {/* Lens Info & Resolution */}
            <div className="px-4 py-3 space-y-1">
              <p className="text-sm text-muted-foreground">
                {photo.lens_model || "Main Camera"}
                {photo.f_number && <span> — ƒ{photo.f_number}</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {Math.round((photo.width * photo.height) / 1000000)} MP • {photo.width} × {photo.height}
              </p>
            </div>

            {/* Settings Row - Only show if we have any camera settings */}
            {(photo.iso || photo.f_number || photo.exposure_time) && (
              <div className="border-t border-white/10 px-4 py-2.5 flex items-center justify-between text-sm text-muted-foreground">
                <span>{photo.iso ? `ISO ${photo.iso}` : '—'}</span>
                <span className="text-white/20">|</span>
                <span>—</span>
                <span className="text-white/20">|</span>
                <span>0 ev</span>
                <span className="text-white/20">|</span>
                <span>{photo.f_number ? `ƒ${photo.f_number}` : '—'}</span>
                <span className="text-white/20">|</span>
                <span>{photo.exposure_time ? `${photo.exposure_time}s` : '—'}</span>
              </div>
            )}
          </div>
        ) : (
          /* Fallback Resolution Card - Same style as Camera Info Card */
          (photo.width > 0 && photo.height > 0) && (
            <div className="bg-secondary/50 rounded-xl overflow-hidden backdrop-blur-sm border border">
              {/* Header */}
              <div className="bg-white/5 px-4 py-0.5 border-b border-white/10">
                <span className="font-medium text-sm text-foreground">
                  Photo
                </span>
              </div>

              {/* Resolution Info */}
              <div className="px-4 py-3 space-y-1">
                <p className="text-sm text-muted-foreground">
                  {Math.round((photo.width * photo.height) / 1000000)} MP • {photo.width} × {photo.height}
                </p>
              </div>
            </div>
          )
        )}

        {/* Location */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <IconMapPin className="w-3 h-3 shrink-0" />
            <span>Location</span>
          </div>
          {hasLocation ? (
            <p className="text-sm">
              {photo.latitude!.toFixed(6)}, {photo.longitude!.toFixed(6)}
            </p>
          ) : isAddingLocation ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Latitude"
                value={tempLat}
                onChange={(e) => setTempLat(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border/30 text-sm"
              />
              <input
                type="text"
                placeholder="Longitude"
                value={tempLng}
                onChange={(e) => setTempLng(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border/30 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveLocation} disabled={isSaving} className="flex-1">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsAddingLocation(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsAddingLocation(true)}
              className="w-full"
            >
              Add Location
            </Button>
          )}
        </div>

        {/* Date (Moved below Location) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <IconCalendar className="w-3 h-3 shrink-0" />
            <span>Captured Date</span>
          </div>
          {hasDate ? (
            <p className="text-sm">{formatDate(photo.captured_at!)}</p>
          ) : isAddingDate ? (
            <div className="space-y-2">
              <Popover modal={true}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal">
                    {tempDate ? tempDate.toLocaleDateString() : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50" align="start">
                  <Calendar
                    mode="single"
                    selected={tempDate}
                    onSelect={setTempDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveDate} disabled={isSaving || !tempDate} className="flex-1">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsAddingDate(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsAddingDate(true)}
              className="w-full"
            >
              Add Date
            </Button>
          )}
        </div>

      </div>
    </motion.div >
  );
}

// Helper for formatting bytes (Quick implementation as it's missing in component scope)
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function GlobalPhotoSlider({ visible, onClose, index, onIndexChange, photos, thumbnails, onPhotoUpdate }: QuickPhotoSliderProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [originalStatus, setOriginalStatus] = useState<OriginalStatus | null>(null);
  const [isLoadingOriginal, setIsLoadingOriginal] = useState(false);
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  const currentPhoto = photos[index];

  // Helper to load original (reused for auto-load and manual click)
  const loadOriginalImage = useCallback(async () => {
    if (!currentPhoto) return;
    console.log('[Original] Start loading full resolution image...');
    console.log('[Original] media_type:', currentPhoto.media_type);
    setIsLoadingOriginal(true);
    try {
      const base64 = await getOriginal(currentPhoto.id);
      console.log('[Original] Successfully loaded full resolution image');

      // Determine MIME type based on media_type and filename
      let mimeType = 'image/webp'; // Default for transcoded images

      const ext = currentPhoto.filename.split('.').pop()?.toLowerCase();

      if (currentPhoto.media_type === 'video') {
        console.log('[Original] Detected VIDEO, setting video MIME type');
        mimeType = 'video/mp4'; // fallback common type
        if (ext === 'mov') mimeType = 'video/quicktime';
        if (ext === 'webm') mimeType = 'video/webm';
      } else {
        // Handle passthrough image formats
        if (ext === 'heic') mimeType = 'image/heic';
        if (ext === 'heif') mimeType = 'image/heif';
        if (ext === 'png') mimeType = 'image/png';
        if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        if (ext === 'avif') mimeType = 'image/avif';
      }

      console.log('[Original] Setting originalSrc with MIME:', mimeType);
      setOriginalSrc(`data:${mimeType};base64,${base64}`);
      setOriginalStatus(prev => prev ? ({ ...prev, status: 'cached', cached: true }) : null);
    } catch (e) {
      console.error('Failed to load original:', e);
      toast.error('Failed to load original');
    } finally {
      setIsLoadingOriginal(false);
    }
  }, [currentPhoto]);

  // Check original status when photo changes
  useEffect(() => {
    if (!currentPhoto) return;

    // Reset state for new photo
    setOriginalStatus(null);
    setOriginalSrc(null);

    // Check original status
    checkOriginalStatus(currentPhoto.id)
      .then((status) => {
        console.log('[Original] Status:', status);
        setOriginalStatus(status);
        // Auto-load if cached or restored
        if (status.cached || status.status === 'restored') {
          console.log('[Original] Cache/Restored detected, auto-loading...');
          setIsLoadingOriginal(true);
          getOriginal(currentPhoto.id).then(base64 => {
            // Determine MIME type based on media_type (same logic as loadOriginalImage)
            let mimeType = 'image/webp'; // Default
            if (currentPhoto.media_type === 'video') {
              console.log('[Original] Auto-load: Detected VIDEO, setting video MIME type');
              mimeType = 'video/mp4'; // fallback common type
              if (currentPhoto.filename.toLowerCase().endsWith('.mov')) mimeType = 'video/quicktime';
              if (currentPhoto.filename.toLowerCase().endsWith('.webm')) mimeType = 'video/webm';
            }
            console.log('[Original] Auto-load: Setting originalSrc with MIME:', mimeType);
            setOriginalSrc(`data:${mimeType};base64,${base64}`);
            setOriginalStatus({ ...status, status: 'cached', cached: true });
            setIsLoadingOriginal(false);
          }).catch(e => {
            console.error(e);
            setIsLoadingOriginal(false);
          });
        }
      })
      .catch((e) => console.error('Failed to check original status:', e));
  }, [currentPhoto?.id]);

  // Handle manual load request
  const handleLoadOriginal = useCallback(async () => {
    if (!currentPhoto || !originalStatus) return;

    // If archived, request restore
    if (originalStatus.status === 'archived') {
      setIsLoadingOriginal(true);
      try {
        const result = await requestOriginalRestore(currentPhoto.id);
        console.log('[Original] Restore requested:', result);
        const newStatus = await checkOriginalStatus(currentPhoto.id);
        setOriginalStatus(newStatus);
        toast.info('Restore requested. It may take up to 12 hours.');
      } catch (e) {
        console.error('Failed to request restore:', e);
        toast.error('Failed to request restore');
      } finally {
        setIsLoadingOriginal(false);
      }
      return;
    }

    // If available/restored, load it
    loadOriginalImage();
  }, [currentPhoto, originalStatus, loadOriginalImage]);

  // Handle Download
  const handleDownload = async () => {
    if (!currentPhoto) return;

    // If not loaded, trigger load and warn
    if (!originalSrc) {
      console.log('[Download] Original not loaded, triggering load...');
      toast('Loading original file...', { duration: 3000 });
      loadOriginalImage();
      return;
    }

    try {
      const path = await save({
        defaultPath: currentPhoto.filename,
      });
      if (path) {
        const base64 = originalSrc.split(',')[1];
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        await writeFile(path, bytes);
        toast.success('Saved to ' + path);
      }
    } catch (e) {
      console.error('Download failed', e);
      toast.error('Download failed');
    }
  };

  // Helper handling
  const handleUpdate = (updates: Partial<PhotoMetadata>) => {
    if (currentPhoto && onPhotoUpdate) {
      onPhotoUpdate(currentPhoto.id, updates);
    }
  };

  return (
    <PhotoSlider
      images={photos.map((p) => ({
        src: (p.id === currentPhoto?.id && originalSrc) ? originalSrc : (thumbnails[p.id] || ''),
        key: p.id,
        // Custom render for video originals
        render: (p.id === currentPhoto?.id && originalSrc && p.media_type === 'video') ? () => (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <video
              src={originalSrc}
              controls
              autoPlay
              className="max-w-full max-h-full"
              style={{ maxHeight: '100vh', maxWidth: '100vw' }}
            />
          </div>
        ) : undefined
      }))}
      visible={visible}
      onClose={onClose}
      index={index}
      onIndexChange={onIndexChange}
      speed={() => 300}
      easing={(type) => (type === 2 ? 'cubic-bezier(0.36, 0.66, 0.04, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)')}
      bannerVisible={false}
      toolbarRender={() => null}
      overlayRender={() => (
        <>
          {/* TopBar - matching Gallery header safe area pattern */}
          <div
            className="absolute top-0 left-0 right-0 z-50 pointer-events-none"
            style={{ paddingTop: isDesktop ? '32px' : 'env(safe-area-inset-top)' }}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2 pointer-events-auto">
              {/* Left Side: Load Original Button */}
              <div className="flex items-center gap-3">
                {originalStatus && (
                  <button
                    onClick={handleLoadOriginal}
                    disabled={isLoadingOriginal || originalStatus.status === 'restoring' || originalStatus.status === 'cached'}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-full backdrop-blur-md transition-colors text-sm font-medium
                          ${originalStatus.status === 'cached'
                        ? 'bg-green-500/20 text-green-300 cursor-default opacity-80'
                        : originalStatus.status === 'restoring'
                          ? 'bg-yellow-500/20 text-yellow-300 cursor-not-allowed opacity-80'
                          : 'bg-black/30 text-white/90 hover:bg-black/50'}`}
                    title={originalStatus.status === 'cached' ? 'Viewing original' : 'Load original file'}
                  >
                    {isLoadingOriginal ? (
                      <IconLoader className="w-4 h-4 animate-spin" />
                    ) : originalStatus.status === 'cached' ? (
                      <IconCircleLetterO className="w-4 h-4" />
                    ) : originalStatus.status === 'restoring' ? (
                      <IconClock className="w-4 h-4" />
                    ) : (
                      <IconCircleDashedLetterO className="w-4 h-4" />
                    )}
                    <span>
                      {originalStatus.status === 'cached'
                        ? 'Viewing Original'
                        : originalStatus.status === 'restoring'
                          ? 'Restoring...'
                          : 'Load Original'}
                    </span>
                  </button>
                )}
              </div>

              {/* Right Side: Download, Info & Close */}
              <div className="flex items-center gap-3">
                {originalStatus && (
                  <button
                    onClick={handleDownload}
                    className="p-2.5 rounded-full backdrop-blur-md bg-black/30 text-white/90 hover:bg-black/50 transition-colors"
                    title="Download Original"
                  >
                    <IconDownload className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  className="p-2.5 rounded-full backdrop-blur-md bg-black/30 text-white/90 hover:bg-black/50 transition-colors"
                  title="Information"
                >
                  {
                    !showInfo ? <IconInfoCircle className="w-5 h-5" /> : <IconInfoCircleFilled className="w-5 h-5" />
                  }
                </button>
                <button
                  onClick={onClose}
                  className="p-2.5 rounded-full backdrop-blur-md bg-black/30 text-white/90 hover:bg-black/50 transition-colors"
                  title="Close"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {showInfo && currentPhoto && (
              <MetadataPanel
                photo={currentPhoto}
                onClose={() => setShowInfo(false)}
                onUpdate={handleUpdate}
                isDesktop={isDesktop}
              />
            )}
          </AnimatePresence>
        </>
      )}
    />
  );
}

export function PhotoLightbox({ children }: any) {
  // Deprecated wrapper kept for backwards compat but not used
  return (
    <PhotoProvider>
      {children}
    </PhotoProvider>
  );
}

export { PhotoProvider, PhotoView };

