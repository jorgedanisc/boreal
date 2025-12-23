import { Button } from '@/components/ui/button';
import { GlobalPhotoSlider } from '@/components/gallery/PhotoLightbox';
import { getAllPhotosWithGeolocation, getThumbnailForVault, GeoPhoto } from '@/lib/vault';
import { useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, NavigationIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'react-photo-view/dist/react-photo-view.css';

// Cluster interface
interface PhotoCluster {
  id: string;
  latitude: number;
  longitude: number;
  photos: GeoPhoto[];
  thumbnail?: string;
}

// Grid-based spatial clustering
function clusterPhotos(photos: GeoPhoto[], zoomLevel: number): PhotoCluster[] {
  // Cell size decreases as zoom increases (step-wise to prevent drifting)
  const discreteZoom = Math.floor(zoomLevel);
  const cellSize = 360 / Math.pow(2, discreteZoom + 1);
  const clusters = new Map<string, GeoPhoto[]>();

  for (const photo of photos) {
    const cellX = Math.floor(photo.longitude / cellSize);
    const cellY = Math.floor(photo.latitude / cellSize);
    const key = `${cellX},${cellY}`;

    if (!clusters.has(key)) {
      clusters.set(key, []);
    }
    clusters.get(key)!.push(photo);
  }

  return Array.from(clusters.entries()).map(([key, photosInCluster]) => {
    // Calculate centroid
    const avgLat = photosInCluster.reduce((sum, p) => sum + p.latitude, 0) / photosInCluster.length;
    const avgLng = photosInCluster.reduce((sum, p) => sum + p.longitude, 0) / photosInCluster.length;

    return {
      id: key,
      latitude: avgLat,
      longitude: avgLng,
      photos: photosInCluster,
    };
  });
}

export function MapPage() {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [photos, setPhotos] = useState<GeoPhoto[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [zoomLevel, setZoomLevel] = useState(2);
  const [isLoading, setIsLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Lightbox State
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxPhotos, setLightboxPhotos] = useState<GeoPhoto[]>([]);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  // Load geolocated photos
  useEffect(() => {
    loadPhotos();
  }, []);

  const loadPhotos = async () => {
    try {
      setIsLoading(true);
      const geoPhotos = await getAllPhotosWithGeolocation();
      setPhotos(geoPhotos);

      // Load thumbnails for first few photos in each cluster (for preview)
      const uniquePhotos = geoPhotos.slice(0, 50); // Limit initial load
      await Promise.all(uniquePhotos.map(async (p: GeoPhoto) => {
        try {
          const b64 = await getThumbnailForVault(p.id, p.vault_id);
          if (b64) {
            setThumbnails(prev => ({ ...prev, [p.id]: `data:image/webp;base64,${b64}` }));
          }
        } catch (e) {
          console.error(`Failed to load thumbnail for ${p.id}`, e);
        }
      }));
    } catch (e) {
      console.error('Failed to load geolocated photos:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const { i18n } = useTranslation();

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    console.log('[Map] Initializing MapLibre...');

    // Get locale for map labels (supports language part only)
    const mapLocale = i18n.language?.split('-')[0] || 'en';

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [0, 30],
      zoom: 2,
      attributionControl: false,
    });

    // Set ref immediately so other effects can use it
    mapRef.current = map;

    map.on('load', () => {
      console.log('[Map] Map loaded successfully');
    });

    map.on('error', (e) => {
      console.error('[Map] MapLibre error:', e);
    });

    // Update zoom level only after move ends to prevent marker jitter/drifting
    map.on('moveend', () => {
      setZoomLevel(Math.floor(map.getZoom()));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Compute clusters based on zoom level
  const clusters = useMemo(() => {
    return clusterPhotos(photos, zoomLevel);
  }, [photos, zoomLevel]);

  // Update markers when clusters change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add new markers
    for (const cluster of clusters) {
      const firstPhoto = cluster.photos[0];
      const thumbnailSrc = thumbnails[firstPhoto.id];
      const count = cluster.photos.length;

      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'photo-marker';
      el.style.cssText = `
        width: 62px;
        height: 66px;
        border-radius: 4px;
        cursor: pointer;
        position: relative;
      `;

      // Thumbnail container
      const thumbContainer = document.createElement('div');
      thumbContainer.style.cssText = `
        width: 58px;
        height: 58px;
        border-radius: 8px;
        overflow: hidden;
        background: #1a1a1a;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        position: relative;
      `;

      if (thumbnailSrc) {
        const img = document.createElement('img');
        img.src = thumbnailSrc;
        img.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
        `;
        thumbContainer.appendChild(img);
      }

      // Count badge
      if (count > 1) {
        const badge = document.createElement('div');
        badge.textContent = count.toString();
        badge.style.cssText = `
          position: absolute;
          bottom: 0px;
          left: 0px;
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 5px;
          border-radius: 4px;
          min-width: 16px;
          text-align: center;
          shadow: 0 0 2px rgba(0,0,0,0.7);
        `;
        thumbContainer.appendChild(badge);
      }

      el.appendChild(thumbContainer);

      // Pin pointer
      const pointer = document.createElement('div');
      pointer.style.cssText = `
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 8px solid white;
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
      `;
      el.appendChild(pointer);

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([cluster.longitude, cluster.latitude])
        .addTo(map);

      // Add click listener to open lightbox with cluster photos
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setLightboxPhotos(cluster.photos);
        setLightboxIndex(0);
        setLightboxOpen(true);
      });

      markersRef.current.push(marker);
    }
  }, [clusters, thumbnails]);

  // Fly to user location
  const flyToUserLocation = useCallback(() => {
    if (!mapRef.current) return;

    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        mapRef.current?.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 12,
          duration: 2000,
        });
      },
      (error) => {
        console.error('Geolocation error:', error);
        if (error.code === 1) {
          setLocationError('Location access denied. Please enable location in System Settings.');
        } else if (error.code === 2) {
          setLocationError('Location unavailable');
        } else {
          setLocationError('Could not get location');
        }
        // Clear error after 3 seconds
        setTimeout(() => setLocationError(null), 3000);
      }
    );
  }, []);

  // Fit bounds to all photos
  useEffect(() => {
    const map = mapRef.current;
    if (!map || photos.length === 0) return;

    // Wait for map to be ready
    if (!map.loaded()) {
      map.on('load', () => fitBounds());
    } else {
      fitBounds();
    }

    function fitBounds() {
      if (photos.length === 0) return;

      const bounds = new maplibregl.LngLatBounds();
      photos.forEach(p => bounds.extend([p.longitude, p.latitude]));

      map?.fitBounds(bounds, {
        padding: 50,
        maxZoom: 3,
        duration: 1000,
      });
    }
  }, [photos]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative text-foreground flex flex-col h-screen overflow-hidden"
    >
      {/* Map Container - Edge to Edge */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Floating Controls */}
      <div
        className="absolute left-0 right-0 z-30 flex justify-between items-start px-4"
        style={{ top: isDesktop ? "44px" : "calc(12px + env(safe-area-inset-top))" }}
      >
        <Button
          variant="glass"
          size="icon"
          onClick={() => navigate({ to: "/" })}
          className="h-10 w-10 rounded-full shadow-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <Button
          variant="glass"
          size="icon"
          onClick={flyToUserLocation}
          className="h-10 w-10 rounded-full shadow-lg"
        >
          <NavigationIcon className="w-5 h-5 fill-white stroke-white" />
        </Button>
      </div>

      {/* Location error toast */}
      {locationError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute left-4 right-4 z-40"
          style={{ top: isDesktop ? "100px" : "calc(70px + env(safe-area-inset-top))" }}
        >
          <div className="px-4 py-2 rounded-lg bg-destructive/90 backdrop-blur-md text-destructive-foreground text-sm text-center">
            {locationError}
          </div>
        </motion.div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading photos...</p>
          </div>
        </div>
      )}


      {/* Empty state */}
      {!isLoading && photos.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-3 p-6 bg-background/80 backdrop-blur-md rounded-2xl border border-border/30">
            <NavigationIcon className="w-10 h-10 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm text-center">
              No photos with location data found
            </p>
          </div>
        </div>
      )}

      {/* Lightbox */}
      <GlobalPhotoSlider
        photos={lightboxPhotos as any[]} // GeoPhoto fits PhotoMetadata roughly, ignoring strict type for now
        thumbnails={thumbnails}
        visible={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onPhotoUpdate={(id, updates) => {
          setPhotos(prev => prev.map(p => {
            if (p.id === id) {
              return { ...p, ...updates } as GeoPhoto;
            }
            return p;
          }));
        }}
      />
    </motion.div>
  );
}
