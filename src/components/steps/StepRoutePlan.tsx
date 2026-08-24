'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toPng } from 'html-to-image';
import { PoiItem } from '../../lib/types/poi-types';
import { ItineraryPlan } from '../../lib/types/itinerary-types';
import { DayRouteData } from './StepStartEnd';
import { SimplifiedMap } from '../map/SimplifiedMap';
import { ProgressLoadingOverlay } from '../shared/ProgressLoadingOverlay';
import { getClientLogger } from '../../lib/utils/client-logger';

interface StepRoutePlanProps {
  onBack: () => void;
  onReset: () => void;
  selectedAttractions: PoiItem[];
  selectedRestaurants: PoiItem[];
  dayRoutes: DayRouteData[];
  mapCenter: [number, number];
}

export function StepRoutePlan({
  onBack,
  onReset,
  selectedAttractions,
  selectedRestaurants,
  dayRoutes,
  mapCenter: _mapCenter,
}: StepRoutePlanProps): React.ReactElement {
  const [itineraryPlan, setItineraryPlan] = useState<ItineraryPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const logger = getClientLogger();

  const allPOIs = useMemo(
    () => [...selectedAttractions, ...selectedRestaurants],
    [selectedAttractions, selectedRestaurants],
  );

  // Stable dependency signature — prevents duplicate API calls when React
  // StrictMode double-invokes effects or when allPOIs array reference changes
  // but contents remain the same.
  const poiSignature = useMemo(
    () => allPOIs.map((p) => p.id).join(','),
    [allPOIs],
  );

  // Fetch the LLM-generated route plan for the first day
  useEffect(() => {
    if (dayRoutes.length === 0 || allPOIs.length === 0) return;

    const controller = new AbortController();

    const fetchPlan = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const day = dayRoutes[0];
        const response = await fetch('/api/llm/route-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': logger.getRequestId(),
          },
          body: JSON.stringify({
            startLocation: day.startLocation,
            startLatitude: day.startLatitude,
            startLongitude: day.startLongitude,
            endLocation: day.endLocation,
            endLatitude: day.endLatitude,
            endLongitude: day.endLongitude,
            selectedPois: allPOIs,
          }),
          signal: controller.signal,
        });

        const result = await response.json();

        if (result.success) {
          setItineraryPlan(result.data as ItineraryPlan);
        } else {
          setErrorMessage(result.error ?? 'Failed to generate route plan.');
          logger.error('Route plan API error: ' + (result.error ?? 'unknown'));
        }
      } catch (error) {
        // Ignore abort errors — the request was intentionally cancelled
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        setErrorMessage('Failed to load route plan. Please try again.');
        logger.error('Failed to load route plan - ' + message);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchPlan();

    return () => {
      controller.abort();
    };
  }, [dayRoutes, poiSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Download: capture the full content (map + markdown) as PNG
  const handleDownload = useCallback(async () => {
    if (captureRef.current === null) return;

    // Temporarily expand markdown to full height so html-to-image captures everything
    const markdownEl = markdownRef.current;
    if (markdownEl !== null) {
      markdownEl.style.maxHeight = 'none';
      markdownEl.style.overflow = 'visible';
    }

    try {
      const dataUrl = await toPng(captureRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#faf8f5',
        cacheBust: true,
        style: {
          overflow: 'visible',
        },
      });

      // Restore scrollable state
      if (markdownEl !== null) {
        markdownEl.style.maxHeight = '';
        markdownEl.style.overflow = '';
      }

      const link = document.createElement('a');
      link.download = `travel-plan-${dayRoutes[0]?.startLocation ?? 'route'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      // Restore even on error
      if (markdownEl !== null) {
        markdownEl.style.maxHeight = '';
        markdownEl.style.overflow = '';
      }
      logger.error('Failed to download image - ' + String(error));
    }
  }, [dayRoutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Utility: get the first day's start/end coordinates for the simplified map
  const firstDay = dayRoutes.length > 0 ? dayRoutes[0] : null;

  return (
    <section className="flex flex-col">
      <ProgressLoadingOverlay isLoading={isLoading} />

      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between mb-2">
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={onBack}
            className="pencil-btn text-xs sm:text-sm"
          >
            返回
          </button>
          <div>
            <h2 className="pencil-heading text-sm sm:text-lg">路线规划</h2>
            <p className="hidden sm:block font-caveat text-xs text-stone-500">
              {firstDay !== null ? firstDay.startLocation + ' → ' + firstDay.endLocation : '一日游行程'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {itineraryPlan !== null && (
            <button
              type="button"
              onClick={handleDownload}
              className="pencil-btn text-xs sm:text-sm"
            >
              下载出行计划
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="pencil-btn text-xs sm:text-sm"
          >
            重新规划出行
          </button>
        </div>
      </div>

      {errorMessage !== null && (
        <div className="mb-2 shrink-0 border-2 border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Main content: simplified map (top) + markdown (bottom) */}
      <div ref={captureRef} className="flex flex-col gap-3 bg-[#faf8f5]">
        {/* Simplified map panel (top) — 20:11 aspect ratio (1000×550 canvas) */}
        <div ref={mapPanelRef} className="relative aspect-[20/11] w-full border-2 border-stone-400 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] bg-white">
          {itineraryPlan !== null ? (
            <SimplifiedMap
              stops={itineraryPlan.stops}
              segments={itineraryPlan.segments}
              startLocation={itineraryPlan.startLocation}
              endLocation={itineraryPlan.endLocation}
              startLatitude={firstDay?.startLatitude ?? 0}
              startLongitude={firstDay?.startLongitude ?? 0}
              endLatitude={firstDay?.endLatitude ?? 0}
              endLongitude={firstDay?.endLongitude ?? 0}
              costBreakdown={itineraryPlan.costBreakdown}
            />
          ) : (
            !isLoading && (
              <div className="flex items-center justify-center h-full">
                <p className="text-stone-400 font-caveat text-lg">
                  {allPOIs.length === 0 ? '请先选择景点和餐厅' : '正在生成路线简图...'}
                </p>
              </div>
            )
          )}
        </div>

        {/* Markdown panel (bottom) — auto-height, no scrollbar, shows full content */}
        <div className="shrink-0 border-2 border-stone-300 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
          {itineraryPlan !== null ? (
            <div
              ref={markdownRef}
              className="prose prose-sm prose-stone max-w-none p-4"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {itineraryPlan.markdownPlan}
              </ReactMarkdown>
            </div>
          ) : (
            !isLoading && (
              <div className="flex items-center justify-center h-full p-8">
                <p className="text-sm text-stone-400">
                  {allPOIs.length === 0
                    ? '请先选择景点和餐厅'
                    : '正在加载出行计划...'}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}