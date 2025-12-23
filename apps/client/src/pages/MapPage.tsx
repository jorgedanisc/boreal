import { GlobalPhotoSlider } from '@/components/gallery/PhotoLightbox';
import { Button } from '@/components/ui/button';
import { GeoPhoto, getAllPhotosWithGeolocation, getThumbnailForVault } from '@/lib/vault';
import { useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { ChevronLeft, NavigationIcon } from 'lucide-react';
import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import 'react-photo-view/dist/react-photo-view.css';

const PHOTOS_SOURCE_ID = 'photos-source';
const CLUSTER_LAYER_ID = 'clusters';

export function MapPage() {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const markersOnScreenRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [photos, setPhotos] = useState<GeoPhoto[]>([]);
  const [photosById, setPhotosById] = useState<Map<string, GeoPhoto>>(new Map());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
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

      // Build lookup map for quick access
      const photoMap = new Map<string, GeoPhoto>();
      geoPhotos.forEach(p => photoMap.set(p.id, p));
      setPhotosById(photoMap);

      // Load thumbnails for photos (for preview)
      const uniquePhotos = geoPhotos.slice(0, 100); // Load more thumbnails for better coverage
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

  // Create a marker element for a cluster or single photo
  const createMarkerElement = useCallback((
    photoIds: string[],
    count: number,
    onClick: () => void
  ) => {
    const firstPhotoId = photoIds[0];
    const thumbnailSrc = thumbnails[firstPhotoId];

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
        text-shadow: 0 0 2px rgba(0,0,0,0.7);
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

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return el;
  }, [thumbnails]);

  // Update markers based on map's clustered features
  // Uses first leaf coordinates for clusters to ensure accurate positioning
  const updateMarkers = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !map.getSource(PHOTOS_SOURCE_ID)) return;

    const newMarkers = new Map<string, maplibregl.Marker>();
    const source = map.getSource(PHOTOS_SOURCE_ID) as GeoJSONSource;

    // Query all visible features from the clustered source
    const features = map.querySourceFeatures(PHOTOS_SOURCE_ID);
    const zoom = map.getZoom();

    // If we are completely zoomed out, don't show any markers
    // This avoids confusing "aggregate" locations that look wrong
    if (zoom < 2) {
      markersOnScreenRef.current.forEach((marker, id) => {
        marker.remove();
      });
      markersOnScreenRef.current.clear();
      return;
    }

    // Process features and resolve cluster positions
    const markerPromises = features.map(async (feature) => {
      const geometry = feature.geometry;
      if (geometry.type !== 'Point') return null;

      const centroidCoords = geometry.coordinates as [number, number];
      const props = feature.properties;

      // Determine if this is a cluster or single point
      const isCluster = props?.cluster === true;
      const clusterId = isCluster ? props.cluster_id : null;
      const pointCount = isCluster ? props.point_count : 1;

      // Create a unique key for this marker
      const markerId = isCluster ? `cluster_${clusterId}` : `photo_${props?.photoId}`;

      // For clusters, we use the centroidCoords (which is the default).
      // We only need to fetch photo info for the thumbnail.
      let markerCoords = centroidCoords;
      let photoIds: string[] = [];
      let clusterPhotos: GeoPhoto[] = [];

      if (isCluster && clusterId !== null) {
        try {
          // Get the first leaf to use for the thumbnail
          const leaves = await source.getClusterLeaves(clusterId, 1, 0);
          if (leaves.length > 0) {
            const leafPhotoId = leaves[0].properties?.photoId;
            if (leafPhotoId) {
              photoIds = [leafPhotoId];
              const photo = photosById.get(leafPhotoId);
              if (photo) clusterPhotos = [photo];
            }
          }
        } catch (e) {
          // Fallback to firstPhotoId from cluster properties
          const firstPhotoId = props?.firstPhotoId;
          if (firstPhotoId) {
            photoIds = [firstPhotoId];
            const photo = photosById.get(firstPhotoId);
            if (photo) {
              clusterPhotos = [photo];
            }
          }
        }
      } else {
        // Single point - use its coordinates directly
        const photoId = props?.photoId;
        if (photoId) {
          photoIds = [photoId];
          const photo = photosById.get(photoId);
          if (photo) clusterPhotos = [photo];
        }
      }

      if (photoIds.length === 0) return null;

      return {
        markerId,
        markerCoords,
        centroidCoords,
        isCluster,
        clusterId,
        pointCount,
        photoIds,
        clusterPhotos
      };
    });

    const resolvedMarkers = (await Promise.all(markerPromises)).filter(Boolean);

    for (const markerData of resolvedMarkers) {
      if (!markerData) continue;

      const {
        markerId,
        markerCoords,
        centroidCoords,
        isCluster,
        clusterId,
        pointCount,
        photoIds,
        clusterPhotos
      } = markerData;

      // Check if we already have this marker
      let marker = markersRef.current.get(markerId);

      if (!marker) {
        // Capture values for click handler closure
        const capturedClusterId = clusterId;
        const capturedIsCluster = isCluster;
        const capturedCoords = markerCoords;
        const capturedClusterPhotos = clusterPhotos;

        const el = createMarkerElement(photoIds, pointCount, async () => {
          const currentMap = mapRef.current;
          if (!currentMap) return;

          if (capturedIsCluster && capturedClusterId !== null) {
            // Get cluster expansion zoom and fly to it
            const currentSource = currentMap.getSource(PHOTOS_SOURCE_ID) as GeoJSONSource;
            if (currentSource) {
              try {
                const expansionZoom = await currentSource.getClusterExpansionZoom(capturedClusterId);
                currentMap.easeTo({
                  center: capturedCoords,
                  zoom: expansionZoom ?? currentMap.getZoom() + 2
                });
              } catch (e) {
                // Fallback: just zoom in
                currentMap.easeTo({
                  center: capturedCoords,
                  zoom: currentMap.getZoom() + 2
                });
              }
            }
          } else {
            // Single photo - open lightbox
            setLightboxPhotos(capturedClusterPhotos);
            setLightboxIndex(0);
            setLightboxOpen(true);
          }
        });

        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(markerCoords);

        markersRef.current.set(markerId, marker);
      } else {
        // Update existing marker position if it changed
        const currentLngLat = marker.getLngLat();
        if (currentLngLat.lng !== markerCoords[0] || currentLngLat.lat !== markerCoords[1]) {
          marker.setLngLat(markerCoords);
        }
      }

      newMarkers.set(markerId, marker);

      // Add to map if not already on screen
      if (!markersOnScreenRef.current.has(markerId)) {
        marker.addTo(map);
      }
    }

    // Remove markers that are no longer on screen
    markersOnScreenRef.current.forEach((marker, id) => {
      if (!newMarkers.has(id)) {
        marker.remove();
      }
    });

    markersOnScreenRef.current = newMarkers;
  }, [createMarkerElement, photosById]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    console.log('[Map] Initializing MapLibre...');

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: '/boreal-map-tiles-style.json',
      center: [0, 30],
      zoom: 2,
      attributionControl: false,
      localIdeographFontFamily: 'Metropolis, "Noto Sans", sans-serif',
    });

    mapRef.current = map;

    map.on('load', () => {
      console.log('[Map] Map loaded successfully');
    });

    map.on('error', (e) => {
      console.error('[Map] MapLibre error:', e);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add/update GeoJSON source with clustering when photos change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || photos.length === 0) return;

    const setupSource = () => {
      // Create GeoJSON FeatureCollection from photos
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: photos.map(photo => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [photo.longitude, photo.latitude]
          },
          properties: {
            photoId: photo.id,
            vaultId: photo.vault_id
          }
        }))
      };

      // Check if source already exists
      if (map.getSource(PHOTOS_SOURCE_ID)) {
        // Update existing source
        (map.getSource(PHOTOS_SOURCE_ID) as GeoJSONSource).setData(geojson);
      } else {
        // Add new clustered source
        map.addSource(PHOTOS_SOURCE_ID, {
          type: 'geojson',
          data: geojson,
          cluster: true,
          clusterMaxZoom: 14, // Max zoom to cluster points
          clusterRadius: 40, // Reduced radius for tighter, more accurate clusters
          clusterProperties: {
            // Store the first photo ID for thumbnail display
            firstPhotoId: ['coalesce', ['get', 'photoId'], '']
          }
        });

        // Add an invisible layer to enable querySourceFeatures
        // We use HTML markers for visual display, but need a layer for clustering to work
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: 'circle',
          source: PHOTOS_SOURCE_ID,
          paint: {
            'circle-radius': 0,
            'circle-opacity': 0
          }
        });
      }

      // Initial marker update
      updateMarkers();

      // Fit bounds to all photos
      const bounds = new maplibregl.LngLatBounds();
      photos.forEach(p => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 3,
        duration: 1000,
      });
    };

    if (map.loaded()) {
      setupSource();
    } else {
      map.on('load', setupSource);
    }

    // Update markers on map movement
    const onRender = () => updateMarkers();
    map.on('render', onRender);

    return () => {
      map.off('render', onRender);
    };
  }, [photos, updateMarkers]);

  // Re-create markers when thumbnails update
  useEffect(() => {
    // Clear old markers and recreate with new thumbnails
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();
    markersOnScreenRef.current.clear();
    updateMarkers();
  }, [thumbnails, updateMarkers]);

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
        setTimeout(() => setLocationError(null), 3000);
      }
    );
  }, []);

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
        photos={lightboxPhotos as any[]}
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
