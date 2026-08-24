'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { PoiItem } from '../../lib/types/poi-types';
import { MapContainer } from '../map/MapContainer';
import { MarkerWithPopup } from '../map/MarkerWithPopup';
import { PoiListPanel } from '../ui/PoiListPanel';
import { TopNCountSlider } from '../ui/TopNCountSlider';
import { ProximityLegend } from '../ui/ProximityLegend';
import { LoadingOverlay } from '../shared/LoadingOverlay';
import { getClientLogger } from '../../lib/utils/client-logger';

type RestaurantMode = 'popularity' | 'proximity';

interface StepRestaurantsProps {
  onComplete: (data: { selectedRestaurants: PoiItem[] }) => void;
  onBack: () => void;
  selectedRestaurants: PoiItem[];
  onToggleRestaurant: (poi: PoiItem) => void;
  cityName: string;
  mapCenter: [number, number];
  selectedAttractions: PoiItem[];
}

/** Distinct color palette for proximity groups — ensures good contrast on the map */
const PROXIMITY_COLORS: string[] = [
  '#e11d48', // rose
  '#2563eb', // blue
  '#d97706', // amber
  '#7c3aed', // violet
  '#059669', // emerald
  '#db2777', // pink
  '#dc2626', // red
  '#0891b2', // cyan
  '#ca8a04', // yellow
  '#4f46e5', // indigo
];

export function StepRestaurants({
  onComplete,
  onBack,
  selectedRestaurants,
  onToggleRestaurant,
  cityName,
  mapCenter,
  selectedAttractions,
}: StepRestaurantsProps): React.ReactElement {
  const [restaurants, setRestaurants] = useState<PoiItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [topCount, setTopCount] = useState(10);
  const [debouncedTopCount, setDebouncedTopCount] = useState(10);
  const [mapInstance, setMapInstance] = useState<AMap.Map | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [restaurantMode, setRestaurantMode] = useState<RestaurantMode>('proximity');
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const logger = getClientLogger();

  // Keep selectedIdsRef in sync
  selectedIdsRef.current = new Set(selectedRestaurants.map((p) => p.id));

  // Debounce topCount to avoid spamming API on slider drag
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTopCount(topCount);
    }, 500);
    return () => clearTimeout(timer);
  }, [topCount]);

  // Build proximity group colors based on selected attractions
  const proximityColors = useMemo<Record<string, string>>(() => {
    const colors: Record<string, string> = {};
    selectedAttractions.forEach((attr, index) => {
      colors[attr.id] = PROXIMITY_COLORS[index % PROXIMITY_COLORS.length];
    });
    return colors;
  }, [selectedAttractions]);

  // Build group name lookup
  const proximityGroupNames = useMemo<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    selectedAttractions.forEach((attr) => {
      names[attr.id] = attr.name;
    });
    return names;
  }, [selectedAttractions]);

  // Load restaurants — either by popularity (city-wide) or proximity (near attractions)
  useEffect(() => {
    if (cityName.length === 0) return;

    // Cancel any previous request
    if (abortRef.current !== null) {
      abortRef.current.abort();
    }
    const abortController = new AbortController();
    abortRef.current = abortController;

    const loadRestaurants = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        if (restaurantMode === 'popularity') {
          // Mode 1: City-wide popularity search (existing behavior)
          const response = await fetch('/api/amap/place', {
            signal: abortController.signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': logger.getRequestId(),
            },
            body: JSON.stringify({
              city: cityName,
              category: 'restaurant',
              limit: debouncedTopCount,
            }),
          });

          const result = await response.json();
          if (abortController.signal.aborted) return;

          if (!result.success) {
            setErrorMessage(result.error);
            logger.error('Failed to load restaurants - ' + result.error);
            return;
          }

          const loadedPois = result.data as PoiItem[];
          setRestaurants(loadedPois);
          logger.info('Loaded ' + loadedPois.length + ' restaurants by popularity for ' + cityName);
        } else {
          // Mode 2: Proximity-based — search near each selected attraction
          if (selectedAttractions.length === 0) {
            setRestaurants([]);
            setIsLoading(false);
            return;
          }

          const allNearbyPois: PoiItem[] = [];
          const seenIds = new Set<string>();

          // Fetch nearby restaurants for each attraction in parallel
          const fetchPromises = selectedAttractions.map(async (attr) => {
            const response = await fetch('/api/amap/place-around', {
              signal: abortController.signal,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-request-id': logger.getRequestId(),
              },
              body: JSON.stringify({
                location: { longitude: attr.longitude, latitude: attr.latitude },
                category: 'restaurant',
                limit: debouncedTopCount,
                proximityGroupId: attr.id,
                proximityGroupName: attr.name,
              }),
            });

            const result = await response.json();
            if (abortController.signal.aborted) return null;
            if (!result.success) {
              logger.warn('Nearby search failed for ' + attr.name + ' - ' + result.error);
              return null;
            }
            return result.data as PoiItem[];
          });

          const results = await Promise.all(fetchPromises);
          if (abortController.signal.aborted) return;

          for (const pois of results) {
            if (pois === null) continue;
            for (const poi of pois) {
              // Deduplicate: if a restaurant is near multiple attractions, keep the first occurrence
              if (!seenIds.has(poi.id)) {
                seenIds.add(poi.id);
                allNearbyPois.push(poi);
              }
            }
          }

          setRestaurants(allNearbyPois);
          logger.info('Loaded ' + allNearbyPois.length + ' restaurants by proximity from ' + selectedAttractions.length + ' attractions');
        }
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        setErrorMessage('Failed to load restaurants. Please try again.');
        logger.error('Failed to load restaurants - ' + message);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadRestaurants();

    return () => {
      abortController.abort();
    };
  }, [cityName, debouncedTopCount, restaurantMode, selectedAttractions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamic zoom: fit all POI markers on initial load
  useEffect(() => {
    if (mapInstance === null || restaurants.length === 0) return;

    setTimeout(() => {
      mapInstance.setFitView(undefined, false, [80, 80, 80, 80]);
    }, 150);
  }, [mapInstance, restaurants]);

  // Locate a single POI: move map and zoom to it
  const handleLocate = useCallback(
    (poi: PoiItem) => {
      setHighlightedId(poi.id);
      mapInstance?.setZoom(16);
      mapInstance?.setCenter([poi.longitude, poi.latitude]);
    },
    [mapInstance],
  );

  // Toggle selection AND center the map on the POI
  const handleToggleAndLocate = useCallback(
    (poi: PoiItem) => {
      onToggleRestaurant(poi);
      setHighlightedId(poi.id);
      mapInstance?.setZoom(16);
      mapInstance?.setCenter([poi.longitude, poi.latitude]);
    },
    [onToggleRestaurant, mapInstance],
  );

  const handleHighlight = useCallback((id: string | null) => {
    setHighlightedId(id);
  }, []);

  const handleTopCountChange = useCallback((newTopCount: number): void => {
    setTopCount(newTopCount);
  }, []);

  const handleComplete = useCallback((): void => {
    logger.info('Step 3 completed - ' + selectedRestaurants.length + ' restaurants selected');
    onComplete({ selectedRestaurants });
  }, [selectedRestaurants, onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset restaurants when mode changes — the useEffect will refetch
  const handleModeChange = useCallback((mode: RestaurantMode) => {
    setRestaurantMode(mode);
    setRestaurants([]);
  }, []);

  const descriptionText = restaurantMode === 'popularity'
    ? '城市范围内按评分排序的热门餐厅'
    : '根据已选景点位置，查找附近餐厅';

  return (
    <section className="flex h-full flex-col">
      <LoadingOverlay isLoading={isLoading} message="正在搜索餐厅..." />

      {/* Top bar: title, integrated mode toggle, count slider, and action buttons */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2 sm:pb-3">
        <div className="flex items-center gap-2 sm:gap-4">
          <button type="button" onClick={onBack} className="pencil-btn text-xs sm:text-sm">
            返回
          </button>
          <div>
            <h2 className="pencil-heading text-sm sm:text-lg">选择餐厅</h2>
            <p className="hidden sm:block font-caveat text-xs text-stone-500">
              {cityName.length > 0 ? descriptionText : '请先在上方选择城市'}
            </p>
          </div>
          {cityName.length > 0 && (
            <div className="flex rounded border-2 border-stone-400 overflow-hidden">
              <button
                type="button"
                onClick={() => handleModeChange('proximity')}
                disabled={selectedAttractions.length === 0}
                className={`px-2.5 py-1 text-xs font-caveat font-bold transition-colors ${
                  restaurantMode === 'proximity'
                    ? 'bg-stone-800 text-white'
                    : 'bg-white text-stone-600 hover:bg-stone-100'
                } ${selectedAttractions.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                景点距离综合
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('popularity')}
                className={`px-2.5 py-1 text-xs font-caveat font-bold transition-colors ${
                  restaurantMode === 'popularity'
                    ? 'bg-stone-800 text-white'
                    : 'bg-white text-stone-600 hover:bg-stone-100'
                }`}
              >
                餐厅热度优先
              </button>
            </div>
          )}
          {restaurantMode === 'popularity' && (
            <span className="hidden sm:inline font-caveat text-xs text-stone-400">
              按评分排序
            </span>
          )}
          {restaurantMode === 'proximity' && (
            <span className="hidden sm:inline font-caveat text-xs text-stone-400">
              基于 {selectedAttractions.length} 个景点
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {cityName.length > 0 && (
            <div className="hidden sm:block w-44">
              <TopNCountSlider
                value={topCount}
                minValue={5}
                maxValue={30}
                onChange={handleTopCountChange}
                label="显示数量"
              />
            </div>
          )}
          <button
            type="button"
            onClick={handleComplete}
            disabled={selectedRestaurants.length === 0}
            className="pencil-btn-primary text-xs sm:text-sm disabled:opacity-50"
          >
            下一步 ({selectedRestaurants.length})
          </button>
        </div>
      </div>

      

      {/* Error message */}
      {errorMessage !== null && (
        <div className="mb-3 shrink-0 border-2 border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* 1:4 layout: list + map on desktop; toggleable on mobile */}
      {cityName.length > 0 && (
        <>
          {/* Mobile view toggle */}
          <div className="flex shrink-0 gap-2 pb-2 lg:hidden">
            <button
              type="button"
              onClick={() => setShowList(true)}
              className={`flex-1 rounded border-2 px-3 py-1.5 text-xs font-caveat font-bold transition-colors ${
                showList
                  ? 'border-stone-600 bg-stone-800 text-white'
                  : 'border-stone-300 bg-white text-stone-600'
              }`}
            >
              餐厅列表 ({restaurants.length})
            </button>
            <button
              type="button"
              onClick={() => setShowList(false)}
              className={`flex-1 rounded border-2 px-3 py-1.5 text-xs font-caveat font-bold transition-colors ${
                !showList
                  ? 'border-stone-600 bg-stone-800 text-white'
                  : 'border-stone-300 bg-white text-stone-600'
              }`}
            >
              地图视图
            </button>
          </div>

          <div className="flex min-h-0 flex-1 gap-3">
            {/* Left: POI list - hidden on mobile when map is active */}
            <div className={`${showList ? 'flex' : 'hidden'} lg:flex w-full lg:w-1/5 shrink-0`}>
              <PoiListPanel
                pois={restaurants}
                selectedIds={selectedIdsRef.current}
                highlightedId={highlightedId}
                onHighlight={handleHighlight}
                onSelect={handleToggleAndLocate}
                onLocate={handleLocate}
                label="餐厅"
                className="w-full"
                proximityColors={restaurantMode === 'proximity' ? proximityColors : undefined}
              />
            </div>

            {/* Right: Map - hidden on mobile when list is active */}
            <div
              ref={mapContainerRef}
              className={`${!showList ? 'flex' : 'hidden'} lg:flex relative flex-1 overflow-hidden border-2 border-stone-400 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]`}
            >
              {/* Floating proximity legend on map */}
              {restaurantMode === 'proximity' && selectedAttractions.length > 0 && (
                <div className="absolute top-2 left-2 z-10">
                  <ProximityLegend colors={proximityColors} groupNames={proximityGroupNames} />
                </div>
              )}
              <MapContainer mapCenter={mapCenter} zoomLevel={12} onMapInstanceReady={setMapInstance} />
              {mapInstance !== null &&
                restaurants.map((poi, index) => (
                  <MarkerWithPopup
                    key={poi.id}
                    mapInstance={mapInstance}
                    poi={poi}
                    isSelected={selectedRestaurants.some((item) => item.id === poi.id)}
                    isHighlighted={highlightedId === poi.id}
                    markerIndex={index}
                    onAddToItinerary={handleToggleAndLocate}
                    onRemoveFromItinerary={handleToggleAndLocate}
                    onHover={handleHighlight}
                    markerColor={
                      restaurantMode === 'proximity' && poi.proximityGroupId !== undefined
                        ? proximityColors[poi.proximityGroupId]
                        : undefined
                    }
                  />
                ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state when no city selected */}
      {cityName.length === 0 && (
        <div className="flex flex-1 items-center justify-center border-2 border-stone-300 bg-stone-50 font-caveat text-sm text-stone-500">
          请先在上方选择城市
        </div>
      )}
    </section>
  );
}