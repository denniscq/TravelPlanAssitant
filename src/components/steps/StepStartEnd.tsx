'use client';

import { useState, useCallback } from 'react';
import { PlaceAutocomplete } from '../ui/PlaceAutocomplete';

interface DayRouteData {
  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  endLatitude: number;
  endLongitude: number;
}

interface StepStartEndProps {
  onComplete: (data: { dayRoutes: DayRouteData[] }) => void;
  initialData?: {
    dayRoutes: DayRouteData[];
  };
}

function createEmptyDayRoute(): DayRouteData {
  return {
    startLocation: '',
    startLatitude: 0,
    startLongitude: 0,
    endLocation: '',
    endLatitude: 0,
    endLongitude: 0,
  };
}

export function StepStartEnd({
  onComplete,
  initialData,
}: StepStartEndProps): React.ReactElement {
  const [dayRoutes, setDayRoutes] = useState<DayRouteData[]>(
    initialData?.dayRoutes ?? [createEmptyDayRoute()]
  );

  const updateDayRoute = useCallback(
    (dayIndex: number, updates: Partial<DayRouteData>): void => {
      setDayRoutes((prev) => {
        const next = [...prev];
        next[dayIndex] = { ...next[dayIndex], ...updates };
        return next;
      });
    },
    []
  );

  const addDay = useCallback((): void => {
    setDayRoutes((prev) => [...prev, createEmptyDayRoute()]);
  }, []);

  const removeDay = useCallback((dayIndex: number): void => {
    setDayRoutes((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== dayIndex);
    });
  }, []);

  const handleComplete = useCallback((): void => {
    // Validate: all start and end locations must be filled
    for (let i = 0; i < dayRoutes.length; i++) {
      const day = dayRoutes[i];
      if (day.startLocation.length === 0 || day.endLocation.length === 0) {
        return;
      }
    }
    onComplete({ dayRoutes });
  }, [dayRoutes, onComplete]);

  const allFilled = dayRoutes.every(
    (day) => day.startLocation.length > 0 && day.endLocation.length > 0
  );

  return (
    <section className="flex flex-col">
      {/* Header with day counter */}
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h2 className="pencil-heading text-lg">设置起终点</h2>
          <p className="font-caveat text-xs text-stone-500">
            为每一天设置出发地点和结束地点
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pencil-label">
            共 {dayRoutes.length} 天行程
          </span>
        </div>
      </div>

      {/* Day cards — no min-height constraint */}
      <div className="space-y-4 mt-4">
        {dayRoutes.map((day, index) => (
          <div
            key={index}
            className="border-2 border-stone-300 p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.1)]"
          >
            {/* Day header */}
            <div className="mb-3 flex items-center justify-between">
              <span className="pencil-heading text-base">
                第 {index + 1} 天
              </span>
              {dayRoutes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDay(index)}
                  className="pencil-btn text-xs"
                >
                  移除
                </button>
              )}
            </div>

            <div className="space-y-3">
              <PlaceAutocomplete
                label="出发地点"
                value={day.startLocation}
                onChange={(val) => updateDayRoute(index, { startLocation: val })}
                onSelect={(suggestion) =>
                  updateDayRoute(index, {
                    startLocation: suggestion.name,
                    startLatitude: suggestion.location[1],
                    startLongitude: suggestion.location[0],
                  })
                }
                placeholder="输入出发位置，如：北京站"
              />

              <PlaceAutocomplete
                label="结束地点"
                value={day.endLocation} 
                onChange={(val) => updateDayRoute(index, { endLocation: val })}
                onSelect={(suggestion) =>
                  updateDayRoute(index, {
                    endLocation: suggestion.name,
                    endLatitude: suggestion.location[1],
                    endLongitude: suggestion.location[0],
                  })
                }
                placeholder="输入结束位置，如：北京王府井希尔顿酒店"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Bottom buttons */}
      <div className="shrink-0 space-y-3 pt-4">
        <button
          type="button"
          onClick={addDay}
          className="pencil-btn w-full text-sm"
        >
          + 添加一天
        </button>

        <button
          type="button"
          onClick={handleComplete}
          disabled={!allFilled}
          className="pencil-btn-primary w-full disabled:opacity-50"
        >
          下一步 ({dayRoutes.length} 天行程)
        </button>
      </div>
    </section>
  );
}

export type { DayRouteData };