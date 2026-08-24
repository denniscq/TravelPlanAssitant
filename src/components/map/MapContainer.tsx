'use client';

import { useEffect, useRef } from 'react';

interface MapContainerProps {
  mapCenter: [number, number];
  zoomLevel: number;
  className?: string;
  onMapInstanceReady?: (mapInstance: AMap.Map) => void;
}

export function MapContainer({
  mapCenter,
  zoomLevel,
  className = '',
  onMapInstanceReady,
}: MapContainerProps): React.ReactElement {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<AMap.Map | null>(null);
  const onReadyRef = useRef(onMapInstanceReady);

  // Keep the callback ref up to date so it's always fresh but never triggers re-init
  useEffect(() => {
    onReadyRef.current = onMapInstanceReady;
  }, [onMapInstanceReady]);

  // Initialize map once on mount — never destroy/recreate on prop changes
  useEffect(() => {
    let isCancelled = false;

    const init = async () => {
      if (mapContainerRef.current === null) {
        return;
      }

      try {
        const { loadAmapJsApi } = await import('../../lib/utils/amap-js-api-loader');
        const AMap = await loadAmapJsApi();

        if (isCancelled || mapContainerRef.current === null) {
          return;
        }

        const mapInstance = new AMap.Map(mapContainerRef.current, {
          center: mapCenter,
          zoom: zoomLevel,
          layers: [new AMap.TileLayer()],
          mapStyle: 'amap://styles/light',
          resizeEnable: true,
        });

        mapInstanceRef.current = mapInstance;

        if (onReadyRef.current !== undefined) {
          onReadyRef.current(mapInstance);
        }
      } catch (error) {
        console.error('Failed to initialize Amap:', error);
      }
    };

    init();

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current !== null) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
    };
    // mapCenter and zoomLevel are used for initial creation only — updates are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center and zoom in-place when props change (no destroy/recreate)
  useEffect(() => {
    if (mapInstanceRef.current !== null) {
      mapInstanceRef.current.setCenter(mapCenter);
      mapInstanceRef.current.setZoom(zoomLevel);
    }
  }, [mapCenter, zoomLevel]);

  return (
    <div
      ref={mapContainerRef}
      className={`w-full h-full min-h-[200px] sm:min-h-[400px] rounded-lg overflow-hidden ${className}`}
    />
  );
}