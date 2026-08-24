'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PoiItem } from '../../lib/types/poi-types';
import { MapContainer } from '../map/MapContainer';
import { MarkerWithPopup } from '../map/MarkerWithPopup';
import { PoiListPanel } from '../ui/PoiListPanel';
import { TopNCountSlider } from '../ui/TopNCountSlider';
import { LoadingOverlay } from '../shared/LoadingOverlay';
import { getClientLogger } from '../../lib/utils/client-logger';

interface StepAttractionsProps {
  onComplete: (data: { selectedAttractions: PoiItem[] }) => void;
  onBack: () => void;
  selectedAttractions: PoiItem[];
  onToggleAttraction: (poi: PoiItem) => void;
  cityName: string;
  mapCenter: [number, number];
}

export function StepAttractions({
  onComplete,
  onBack,
  selectedAttractions,
  onToggleAttraction,
  cityName,
  mapCenter,
}: StepAttractionsProps): React.ReactElement {
  const [attractions, setAttractions] = useState<PoiItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [topCount, setTopCount] = useState(10);
  const [debouncedTopCount, setDebouncedTopCount] = useState(10);
  const [mapInstance, setMapInstance] = useState<AMap.Map | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const logger = getClientLogger();

  // Keep selectedIdsRef in sync
  selectedIdsRef.current = new Set(selectedAttractions.map((p) => p.id));

  // Debounce topCount to avoid spamming API on slider drag
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTopCount(topCount);
    }, 500);
    return () => clearTimeout(timer);
  }, [topCount]);

  // Auto-load attractions when cityName or debouncedTopCount changes
  useEffect(() => {
    if (cityName.length === 0) return;

    const abortController = new AbortController();

    const loadAttractions = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch('/api/amap/place', {
          signal: abortController.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': logger.getRequestId(),
          },
          body: JSON.stringify({
            city: cityName,
            category: 'attraction',
            limit: topCount,
          }),
        });

        const result = await response.json();
        if (abortController.signal.aborted) return;

        if (!result.success) {
          setErrorMessage(result.error);
          logger.error('Failed to load attractions - ' + result.error);
          return;
        }

        const loadedPois = result.data as PoiItem[];
        setAttractions(loadedPois);
        logger.info('Loaded ' + loadedPois.length + ' attractions for ' + cityName);
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        setErrorMessage('Failed to load attractions. Please try again.');
        logger.error('Failed to load attractions - ' + message);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadAttractions();

    return () => {
      abortController.abort();
    };
  }, [cityName, debouncedTopCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamic zoom: fit all POI markers on initial load
  useEffect(() => {
    if (mapInstance === null || attractions.length === 0) return;

    setTimeout(() => {
      mapInstance.setFitView(undefined, false, [80, 80, 80, 80]);
    }, 150);
  }, [mapInstance, attractions]);

  // Locate a single POI: move map and zoom to it
  const handleLocate = useCallback(
    (poi: PoiItem) => {
      setHighlightedId(poi.id);
      mapInstance?.setZoom(14);
      mapInstance?.setCenter([poi.longitude, poi.latitude]);
    },
    [mapInstance],
  );

  const handleHighlight = useCallback((id: string | null) => {
    setHighlightedId(id);
  }, []);

  // Toggle selection AND center the map on the POI (like restaurants)
  const handleToggleAndLocate = useCallback(
    (poi: PoiItem) => {
      onToggleAttraction(poi);
      setHighlightedId(poi.id);
      mapInstance?.setZoom(14);
      mapInstance?.setCenter([poi.longitude, poi.latitude]);
    },
    [onToggleAttraction, mapInstance],
  );

  const handleTopCountChange = useCallback((newTopCount: number): void => {
    setTopCount(newTopCount);
  }, []);

  const handleComplete = useCallback((): void => {
    logger.info('Step 2 completed - ' + selectedAttractions.length + ' attractions selected');
    onComplete({ selectedAttractions });
  }, [selectedAttractions, onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex h-full flex-col">
      <LoadingOverlay isLoading={isLoading} message="正在搜索景点..." />

      {/* Top bar: title, count slider, and action buttons */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2 sm:pb-3">
        <div className="flex items-center gap-2 sm:gap-4">
          <button type="button" onClick={onBack} className="pencil-btn text-xs sm:text-sm">
            返回
          </button>
          <div>
            <h2 className="pencil-heading text-sm sm:text-lg">选择景点</h2>
            <p className="hidden sm:block font-caveat text-xs text-stone-500">
              {cityName.length > 0 ? '点击列表或地图上的标记查看详情，选择景点' : '请先在上方选择城市'}
            </p>
          </div>
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
            disabled={selectedAttractions.length === 0}
            className="pencil-btn-primary text-xs sm:text-sm disabled:opacity-50"
          >
            下一步 ({selectedAttractions.length})
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
              景点列表 ({attractions.length})
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
                pois={attractions}
                selectedIds={selectedIdsRef.current}
                highlightedId={highlightedId}
                onHighlight={handleHighlight}
                onSelect={handleToggleAndLocate}
                onLocate={handleLocate}
                label="景点"
                className="w-full"
              />
            </div>

            {/* Right: Map - hidden on mobile when list is active */}
            <div
              ref={mapContainerRef}
              className={`${!showList ? 'flex' : 'hidden'} lg:flex relative flex-1 overflow-hidden border-2 border-stone-400 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]`}
            >
              <MapContainer mapCenter={mapCenter} zoomLevel={12} onMapInstanceReady={setMapInstance} />
              {mapInstance !== null &&
                attractions.map((poi, index) => (
                  <MarkerWithPopup
                    key={poi.id}
                    mapInstance={mapInstance}
                    poi={poi}
                    isSelected={selectedAttractions.some((item) => item.id === poi.id)}
                    isHighlighted={highlightedId === poi.id}
                    markerIndex={index}
                    onAddToItinerary={onToggleAttraction}
                    onRemoveFromItinerary={onToggleAttraction}
                    onHover={handleHighlight}
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