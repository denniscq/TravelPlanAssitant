'use client';

import { useEffect, useRef } from 'react';
import { ItineraryStop, RouteSegment } from '../../lib/types/itinerary-types';

interface RouteDetailMarkersProps {
  mapInstance: AMap.Map | null;
  stops: ItineraryStop[];
  segments: RouteSegment[];
}

const TRANSPORT_LABELS: Record<string, string> = {
  driving: '驾车',
  walking: '步行',
  transit: '公交',
  cycling: '骑行',
};

const TRANSPORT_COLORS: Record<string, string> = {
  driving: '#c96d24',
  walking: '#22c55e',
  transit: '#3b82f6',
  cycling: '#a855f7',
};

function getMidpoint(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  const mid = Math.floor(coords.length / 2);
  return coords[mid];
}

export function RouteDetailMarkers({ mapInstance, stops, segments }: RouteDetailMarkersProps): React.ReactElement {
  const markerRefs = useRef<AMap.Marker[]>([]);

  useEffect(() => {
    if (mapInstance === null) return;

    const markers: AMap.Marker[] = [];

    // 1. POI text labels — show the POI name directly
    for (const stop of stops) {
      const labelContent = `
        <div style="
          background: rgba(255,255,255,0.95);
          border: 1px solid #44403c;
          border-radius: 2px;
          padding: 3px 10px;
          font-family: 'Caveat', cursive;
          font-size: 13px;
          font-weight: 600;
          color: #1c1917;
          white-space: nowrap;
          box-shadow: 1px 2px 4px rgba(0,0,0,0.15);
          cursor: default;
          user-select: none;
          pointer-events: none;
        ">${stop.poi.name}</div>
      `;

      const marker = new AMap.Marker({
        position: [stop.poi.longitude, stop.poi.latitude],
        map: mapInstance,
        content: labelContent,
        offset: new AMap.Pixel(-20, -20),
        zIndex: 90,
        title: stop.poi.name,
      });

      markers.push(marker);
    }

    // 2. Segment number markers — placed at the midpoint of each segment polyline
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.polylineCoordinates.length === 0) continue;

      const midpoint = getMidpoint(segment.polylineCoordinates);
      const transportLabel = TRANSPORT_LABELS[segment.transportMode] ?? segment.transportMode;
      const color = TRANSPORT_COLORS[segment.transportMode] ?? '#c96d24';

      const segmentContent = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          user-select: none;
          pointer-events: none;
        ">
          <div style="
            width: 34px; height: 34px; border-radius: 50%;
            background: ${color};
            color: #fff;
            border: 3px solid #1c1917;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Caveat', cursive;
            font-size: 18px; font-weight: 700;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          ">${i + 1}</div>
          <div style="
            margin-top: 2px;
            padding: 1px 8px;
            background: rgba(255,255,255,0.95);
            border: 1px solid #44403c;
            font-family: 'Caveat', cursive;
            font-size: 11px;
            font-weight: 600;
            color: #44403c;
            white-space: nowrap;
            box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
          ">${transportLabel}</div>
        </div>
      `;

      const segmentMarker = new AMap.Marker({
        position: midpoint,
        map: mapInstance,
        content: segmentContent,
        offset: new AMap.Pixel(-17, -17),
        zIndex: 95,
        title: `${i + 1}. ${transportLabel}`,
      });

      markers.push(segmentMarker);
    }

    markerRefs.current = markers;

    return () => {
      for (const marker of markerRefs.current) {
        marker.setMap(null);
      }
      markerRefs.current = [];
    };
  }, [mapInstance, stops, segments]);

  return <></>;
}