'use client';

import { useEffect, useRef } from 'react';
import { RouteSegment } from '../../lib/types/itinerary-types';

interface RouteLineProps {
  mapInstance: AMap.Map | null;
  segments: RouteSegment[];
}

const TRANSPORT_MODE_COLORS: Record<string, string> = {
  driving: '#c96d24',
  walking: '#22c55e',
  transit: '#3b82f6',
  cycling: '#a855f7',
};

export function RouteLine({ mapInstance, segments }: RouteLineProps): React.ReactElement {
  const polylineRefs = useRef<AMap.Polyline[]>([]);

  useEffect(() => {
    if (mapInstance === null || segments.length === 0) {
      return;
    }

    const newPolylines: AMap.Polyline[] = [];

    for (const segment of segments) {
      if (segment.polylineCoordinates.length === 0) {
        continue;
      }

      const color = TRANSPORT_MODE_COLORS[segment.transportMode] ?? TRANSPORT_MODE_COLORS.driving;

      const polyline = new AMap.Polyline({
        path: segment.polylineCoordinates,
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.8,
        lineJoin: 'round',
        lineCap: 'round',
        strokeStyle: 'solid',
        map: mapInstance,
      });

      newPolylines.push(polyline);
    }

    polylineRefs.current = newPolylines;

    return () => {
      for (const polyline of polylineRefs.current) {
        polyline.setMap(null);
      }
      polylineRefs.current = [];
    };
  }, [mapInstance, segments]);

  return <></>;
}