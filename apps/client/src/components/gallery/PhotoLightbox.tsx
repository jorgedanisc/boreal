import { PhotoSlider, PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { motion, AnimatePresence } from 'motion/react';
import { InfoIcon, MapPinIcon, CalendarIcon, XIcon, ImageIcon, CheckIcon } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { invoke } from '@tauri-apps/api/core';
import { type } from '@tauri-apps/plugin-os';

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
        <h3 className="font-semibold text-sm">Photo Info</h3>
        <button onClick={onClose} className="p-1 hover:bg-secondary/50 rounded-lg transition-colors">
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Filename */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <ImageIcon className="w-3 h-3 shrink-0" />
            <span>Filename</span>
          </div>
          <p className="text-sm font-medium truncate">{photo.filename}</p>
        </div>

        {/* Dimensions */}
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">
            Dimensions
          </div>
          <p className="text-sm">{photo.width} × {photo.height}</p>
        </div>

        {/* Date */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <CalendarIcon className="w-3 h-3 shrink-0" />
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
                <PopoverContent className="w-auto p-0 z-[2000]" align="start">
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

        {/* Location */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <MapPinIcon className="w-3 h-3 shrink-0" />
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

        {/* Created Date */}
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">
            File Created
          </div>
          <p className="text-sm text-muted-foreground">{formatDate(photo.created_at)}</p>
        </div>
      </div>
    </motion.div >
  );
}

export function GlobalPhotoSlider({ visible, onClose, index, onIndexChange, photos, thumbnails, onPhotoUpdate }: QuickPhotoSliderProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  const currentPhoto = photos[index];

  // Helper handling
  const handleUpdate = (updates: Partial<PhotoMetadata>) => {
    if (currentPhoto && onPhotoUpdate) {
      onPhotoUpdate(currentPhoto.id, updates);
    }
  };

  return (
    <PhotoSlider
      images={photos.map((p) => ({
        src: thumbnails[p.id] || '',
        key: p.id,
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
            <div className="flex items-center justify-end gap-3 px-4 pt-4 pb-2 pointer-events-auto">
              <button
                onClick={() => setShowInfo(!showInfo)}
                className={`p-2.5 rounded-full backdrop-blur-md transition-colors ${showInfo ? 'bg-white/30 text-white' : 'bg-black/30 text-white/90 hover:bg-black/50'}`}
                title="Information"
              >
                <InfoIcon className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2.5 rounded-full backdrop-blur-md bg-black/30 text-white/90 hover:bg-black/50 transition-colors"
                title="Close"
              >
                <XIcon className="w-5 h-5" />
              </button>
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

export { PhotoView, PhotoProvider };
