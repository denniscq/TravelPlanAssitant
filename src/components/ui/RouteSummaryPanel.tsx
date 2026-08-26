'use client';

import { ItineraryPlan, ItineraryStop, RouteSegment } from '../../lib/types/itinerary-types';

interface RouteSummaryPanelProps {
  itineraryPlan: ItineraryPlan;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} 公里`;
  }
  return `${meters} 米`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

function getTransportModeLabel(mode: string): string {
  const modeLabels: Record<string, string> = {
    driving: '驾车',
    taxi: '打车',
    walking: '步行',
    transit: '公交',
    cycling: '骑行',
  };
  return modeLabels[mode] ?? mode;
}

export function RouteSummaryPanel({
  itineraryPlan,
}: RouteSummaryPanelProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-base font-semibold text-stone-800">路线摘要</h3>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-stone-50 p-3">
          <p className="text-xs text-stone-400">总距离</p>
          <p className="text-lg font-semibold text-stone-800">
            {formatDistance(itineraryPlan.totalDistanceInMeters)}
          </p>
        </div>
        <div className="rounded-md bg-stone-50 p-3">
          <p className="text-xs text-stone-400">总时间</p>
          <p className="text-lg font-semibold text-stone-800">
            {formatDuration(itineraryPlan.totalDurationInSeconds)}
          </p>
        </div>
      </div>

      <div className="mb-3">
        <p className="text-xs font-medium text-stone-400">
          {itineraryPlan.startLocation} → {itineraryPlan.endLocation}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-400">
          途经点 ({itineraryPlan.stops.length})
        </p>

        {itineraryPlan.stops.map((stop: ItineraryStop, index: number) => {
          const segmentIndex = index;
          const segment: RouteSegment | undefined = itineraryPlan.segments[segmentIndex];

          return (
            <div key={stop.poi.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-600 text-xs font-semibold text-white">
                  {stop.order}
                </div>
                {index < itineraryPlan.stops.length - 1 && (
                  <div className="h-full w-0.5 bg-stone-200" />
                )}
              </div>
              <div className="flex-1 pb-3">
                <p className="text-sm font-medium text-stone-700">{stop.poi.name}</p>
                <p className="text-xs text-stone-400">
                  到达时间 {stop.suggestedArrivalTime}
                  {stop.suggestedDurationMinutes > 0 &&
                    ` · 停留 ${stop.suggestedDurationMinutes} 分钟`}
                </p>
                {segment !== undefined && (
                  <p className="mt-0.5 text-xs text-stone-400">
                    {getTransportModeLabel(segment.transportMode)} ·{' '}
                    {formatDistance(segment.distanceInMeters)} ·{' '}
                    {formatDuration(segment.durationInSeconds)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}