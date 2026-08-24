'use client';

import { useMemo } from 'react';
import { ItineraryStop, RouteSegment, CostBreakdown, TransportMode } from '../../lib/types/itinerary-types';

interface SimplifiedMapProps {
  stops: ItineraryStop[];
  segments: RouteSegment[];
  startLocation: string;
  endLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  costBreakdown: CostBreakdown;
}

const TRANSPORT_LABELS: Record<string, string> = {
  driving: '驾车',
  walking: '步行',
  transit: '公交',
  cycling: '骑行',
};

/**
 * Globally unique color palette — 10 colors.
 * No two entries (point types or transport modes) share a color.
 * Used in order: transport modes first, then point types.
 */
const UNIQUE_COLORS: string[] = [
  '#c96d24', // orange-brown  — driving
  '#22c55e', // green         — walking
  '#3b82f6', // blue          — transit
  '#a855f7', // purple        — cycling
  '#6366f1', // indigo        — poi
  '#f59e0b', // amber         — restaurant
  '#ef4444', // red           — end
  '#14b8a6', // teal          — (reserve)
  '#ec4899', // pink          — (reserve)
  '#84cc16', // lime          — (reserve)
];

function formatDistance(meters: number): string {
  if (meters >= 1000) return (meters / 1000).toFixed(1) + 'km';
  return Math.round(meters) + 'm';
}

function formatDuration(seconds: number): string {
  const safeSeconds = (!seconds || seconds <= 0 || isNaN(seconds)) ? 60 : seconds;
  const minutes = Math.max(1, Math.round(safeSeconds / 60));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? hours + 'h' + mins + 'min' : hours + 'h';
  }
  return minutes + 'min';
}

/** Generate a slight wobble offset for hand-drawn effect */
function wobble(seed: number): number {
  return (Math.sin(seed * 137.508) * 2 + Math.cos(seed * 73.184) * 1.5) * 0.8;
}

/** Haversine distance in meters between two lat/lng points */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing (direction) from point 1 to point 2, in degrees [0, 360) */
function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Log-distance compression.
 * Maps a real distance in meters to a compressed pixel distance.
 */
function compressDistance(meters: number, maxMeters: number, maxPixels: number): number {
  if (meters <= 0) return 0;
  const normalized = Math.min(meters / maxMeters, 1);
  const compressed = Math.log(1 + normalized * 9) / Math.log(10);
  return compressed * maxPixels;
}

/**
 * Per-segment shape-preserving polyline projection.
 * Maps geographic polyline points to canvas coordinates while preserving
 * perpendicular offsets (road curves/turns) relative to the start→end direction.
 */
function projectPolylinePoint(
  lng: number,
  lat: number,
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
  canvasStartX: number,
  canvasStartY: number,
  canvasEndX: number,
  canvasEndY: number,
): { x: number; y: number } {
  const geoDx = endLng - startLng;
  const geoDy = endLat - startLat;
  const geoLen = Math.sqrt(geoDx * geoDx + geoDy * geoDy);

  if (geoLen < 1e-12) {
    return { x: canvasStartX, y: canvasStartY };
  }

  const px = lng - startLng;
  const py = lat - startLat;

  const along = (px * geoDx + py * geoDy) / (geoLen * geoLen);
  const perp = (px * (-geoDy) + py * geoDx) / geoLen;

  const canvasDx = canvasEndX - canvasStartX;
  const canvasDy = canvasEndY - canvasStartY;
  const canvasLen = Math.sqrt(canvasDx * canvasDx + canvasDy * canvasDy);

  if (canvasLen < 1e-6) {
    return { x: canvasStartX, y: canvasStartY };
  }

  const scale = canvasLen / geoLen;
  const canvasDirX = canvasDx / canvasLen;
  const canvasDirY = canvasDy / canvasLen;
  const perpCanvasX = -canvasDirY;
  const perpCanvasY = canvasDirX;

  const x = canvasStartX + along * canvasDx + perp * scale * perpCanvasX;
  const y = canvasStartY + along * canvasDy + perp * scale * perpCanvasY;

  return { x, y };
}

/** Reverse the direction of an SVG path D string (fixes mirrored textPath text) */
function reversePathD(pathD: string): string {
  const parts = pathD.split(/(?=[ML])/);
  if (parts.length < 2) return pathD;
  const coords: [number, number][] = parts.map((p) => {
    const val = p.trim().substring(1);
    const [x, y] = val.split(',').map(Number);
    return [x, y];
  });
  return coords
    .reverse()
    .map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1))
    .join(' ');
}

/** Compute the total pixel length of an SVG path D string */
function computePathPixelLength(pathD: string): number {
  const parts = pathD.split(/(?=[ML])/);
  if (parts.length < 2) return 0;
  let length = 0;
  let prevX = 0, prevY = 0;
  for (let i = 0; i < parts.length; i++) {
    const val = parts[i].trim().substring(1);
    const [x, y] = val.split(',').map(Number);
    if (i > 0) {
      const dx = x - prevX;
      const dy = y - prevY;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    prevX = x;
    prevY = y;
  }
  return length;
}

/** Check if text would render upside down on this path */
function isPathMirrored(pathD: string): boolean {
  const parts = pathD.split(/(?=[ML])/);
  if (parts.length < 2) return false;
  const first = parts[0].trim().substring(1).split(',').map(Number);
  const last = parts[parts.length - 1].trim().substring(1).split(',').map(Number);
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  // SVG textPath follows the path tangent. Text is mirrored when the direction
  // goes right-to-left (dx < 0) or purely bottom-to-top (dx ≈ 0, dy < 0).
  // In these cases, the tangent angle is outside (-90°, 90°] relative to +X.
  return dx < 0 || (Math.abs(dx) < 1 && dy < 0);
}

/** Build SVG path `d` string from polyline coordinates */
function buildPolylinePath(
  coords: [number, number][],
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
  canvasStartX: number,
  canvasStartY: number,
  canvasEndX: number,
  canvasEndY: number,
  seedOffset: number = 0,
): string {
  if (coords.length === 0) return '';

  const maxPoints = 100;
  const step = Math.max(1, Math.floor(coords.length / maxPoints));
  const sampled: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) {
    sampled.push(coords[i]);
  }
  if (sampled[sampled.length - 1] !== coords[coords.length - 1]) {
    sampled.push(coords[coords.length - 1]);
  }

  return sampled
    .map(([lng, lat], i) => {
      const { x, y } = projectPolylinePoint(
        lng, lat,
        startLng, startLat,
        endLng, endLat,
        canvasStartX, canvasStartY,
        canvasEndX, canvasEndY,
      );
      return (i === 0 ? 'M' : 'L') + (x + wobble(i + seedOffset)).toFixed(1) + ',' + (y + wobble(i + 137 + seedOffset)).toFixed(1);
    })
    .join(' ');
}

/**
 * Smart label placement using quadrant-based collision avoidance.
 * Tries right, left, top, bottom in order.
 */
function findLabelPlacement(
  mx: number, my: number,
  labelWidth: number, labelHeight: number,
  canvasWidth: number, canvasHeight: number,
  usedRects: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number } {
  const PAD = 8;
  const candidates = [
    { dx: PAD + 3, dy: -labelHeight / 2 },                    // right
    { dx: -labelWidth - PAD - 3, dy: -labelHeight / 2 },      // left
    { dx: -labelWidth / 2, dy: -labelHeight - PAD - 3 },      // top
    { dx: -labelWidth / 2, dy: PAD + 3 },                      // bottom
  ];

  for (const c of candidates) {
    const lx = mx + c.dx;
    const ly = my + c.dy;

    if (lx < 2 || ly < 2 || lx + labelWidth > canvasWidth - 2 || ly + labelHeight > canvasHeight - 2) {
      continue;
    }

    const labelRect = { x: lx, y: ly, w: labelWidth, h: labelHeight };
    const overlaps = usedRects.some((r) =>
      !(labelRect.x + labelRect.w < r.x ||
        labelRect.x > r.x + r.w ||
        labelRect.y + labelRect.h < r.y ||
        labelRect.y > r.y + r.h)
    );
    if (!overlaps) {
      return { x: lx, y: ly };
    }
  }

  return { x: mx + PAD + 3, y: my - labelHeight / 2 };
}

export function SimplifiedMap({
  stops,
  segments,
  startLocation,
  endLocation,
  startLatitude,
  startLongitude,
  endLatitude,
  endLongitude,
  costBreakdown: _costBreakdown,
}: SimplifiedMapProps): React.ReactElement {
  const svgMeta = useMemo(() => {
    // Collect all geographic marker points in order: start, poi1..poiN, end
    const allPoints: {
      lng: number; lat: number; label: string;
      type: 'start' | 'end' | 'poi';
      order?: number; arrival?: string; isRestaurant?: boolean;
    }[] = [
      {
        lng: startLongitude, lat: startLatitude,
        label: startLocation, type: 'start',
      },
      ...stops.map((s) => ({
        lng: s.poi.longitude,
        lat: s.poi.latitude,
        label: s.poi.name,
        type: 'poi' as const,
        order: s.order,
        arrival: s.suggestedArrivalTime,
        isRestaurant: s.poi.category === 'restaurant',
      })),
      {
        lng: endLongitude, lat: endLatitude,
        label: endLocation, type: 'end',
      },
    ];

    // === Canvas: 1000 x 550 with reduced margins for better space utilization ===
    const W = 1000;
    const H = 550;
    const MARGIN = 30;
    const plotW = W - MARGIN * 2;
    const plotH = H - MARGIN * 2;

    // === Sequential bearing-based layout with log-distance compression ===

    const segmentDistances: number[] = [];
    for (let i = 0; i < allPoints.length - 1; i++) {
      const d = haversineMeters(
        allPoints[i].lat, allPoints[i].lng,
        allPoints[i + 1].lat, allPoints[i + 1].lng,
      );
      segmentDistances.push(d);
    }

    const maxSegmentDistance = Math.max(...segmentDistances, 1);
    const TOTAL_CANVAS_BUDGET = Math.min(plotW * 0.95, plotH * 5);

    const compressedDistances = segmentDistances.map((d) =>
      compressDistance(d, maxSegmentDistance, TOTAL_CANVAS_BUDGET / allPoints.length),
    );

    // Compute raw positions using bearing-based layout
    // FIX: canvasAngle = (bearing - 90) instead of (90 - bearing) to fix north/south mirror
    const rawPositions: { x: number; y: number }[] = [];
    rawPositions[0] = { x: 0, y: 0 };

    for (let i = 0; i < segmentDistances.length; i++) {
      const prev = rawPositions[i];
      const bearing = bearingDegrees(
        allPoints[i].lat, allPoints[i].lng,
        allPoints[i + 1].lat, allPoints[i + 1].lng,
      );

      const canvasAngle = (bearing - 90) * Math.PI / 180;
      const dist = compressedDistances[i];
      const dx = Math.cos(canvasAngle) * dist;
      const dy = Math.sin(canvasAngle) * dist;

      rawPositions[i + 1] = { x: prev.x + dx, y: prev.y + dy };
    }

    // Normalize raw positions to fill the canvas area
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of rawPositions) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const rawW = Math.max(maxX - minX, 1);
    const rawH = Math.max(maxY - minY, 1);

    // Reduced reserved padding for labels — only what's needed
    const LABEL_PADDING_TOP = 15;
    const LABEL_PADDING_RIGHT = 80;
    const usableW = plotW - LABEL_PADDING_RIGHT;
    const usableH = plotH - LABEL_PADDING_TOP;

    const scaleX = usableW / rawW;
    const scaleY = usableH / rawH;
    const scale = Math.min(scaleX, scaleY);

    const centeredRawW = rawW * scale;
    const centeredRawH = rawH * scale;
    const offsetX = MARGIN + (usableW - centeredRawW) / 2;
    const offsetY = MARGIN + LABEL_PADDING_TOP + (usableH - centeredRawH) / 2;

    // Project raw positions to canvas coordinates
    const projectedPoints = rawPositions.map((p) => ({
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (p.y - minY) * scale,
    }));

    // Enforce minimum pixel spacing
    const MIN_PIXEL_SPACING = 85;
    for (let i = 1; i < projectedPoints.length; i++) {
      const prev = projectedPoints[i - 1];
      const curr = projectedPoints[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      if (pixelDist < MIN_PIXEL_SPACING && pixelDist > 0.1) {
        const s = MIN_PIXEL_SPACING / pixelDist;
        curr.x = prev.x + dx * s;
        curr.y = prev.y + dy * s;
      } else if (pixelDist <= 0.1) {
        curr.x = prev.x;
        curr.y = prev.y + MIN_PIXEL_SPACING;
      }
    }

    // === Build globally-unique color assignments ===
    const usedModes = new Set<TransportMode>();
    for (const seg of segments) {
      usedModes.add(seg.transportMode);
    }
    const hasRestaurant = stops.some((s) => s.poi.category === 'restaurant');

    const colorMap = new Map<string, string>();
    let colorIdx = 0;

    const modeOrder: TransportMode[] = ['driving', 'walking', 'transit', 'cycling'];
    for (const mode of modeOrder) {
      if (usedModes.has(mode)) {
        colorMap.set('mode:' + mode, UNIQUE_COLORS[colorIdx % UNIQUE_COLORS.length]);
        colorIdx++;
      }
    }

    colorMap.set('type:start', UNIQUE_COLORS[colorIdx % UNIQUE_COLORS.length]);
    colorIdx++;
    colorMap.set('type:poi', UNIQUE_COLORS[colorIdx % UNIQUE_COLORS.length]);
    colorIdx++;
    colorMap.set('type:end', UNIQUE_COLORS[colorIdx % UNIQUE_COLORS.length]);
    colorIdx++;
    if (hasRestaurant) {
      colorMap.set('type:restaurant', UNIQUE_COLORS[colorIdx % UNIQUE_COLORS.length]);
      colorIdx++;
    }

    const getSegColor = (mode: TransportMode): string => {
      return colorMap.get('mode:' + mode) ?? '#78716c';
    };

    const getPointColor = (pt: typeof allPoints[number]): string => {
      if (pt.type === 'start') return colorMap.get('type:start') ?? '#78716c';
      if (pt.type === 'end') return colorMap.get('type:end') ?? '#78716c';
      if (pt.isRestaurant) return colorMap.get('type:restaurant') ?? colorMap.get('type:poi') ?? '#78716c';
      return colorMap.get('type:poi') ?? '#78716c';
    };

    // Track used rectangles for smart label placement
    const usedRects: { x: number; y: number; w: number; h: number }[] = [];

    // Build path segments
    const computedPaths = segments.map((seg, i) => {
      const modeColor = getSegColor(seg.transportMode);

      const canvasStart = projectedPoints[seg.originIndex] ?? projectedPoints[0];
      const canvasEnd = projectedPoints[seg.destinationIndex] ?? projectedPoints[projectedPoints.length - 1];

      const geoStart = allPoints[seg.originIndex] ?? allPoints[0];
      const geoEnd = allPoints[seg.destinationIndex] ?? allPoints[allPoints.length - 1];

      let pathD: string;
      let midpoint: { x: number; y: number };
      let pathId = 'route-path-' + i;

      if (seg.polylineCoordinates.length >= 2) {
        pathD = buildPolylinePath(
          seg.polylineCoordinates,
          geoStart.lng, geoStart.lat,
          geoEnd.lng, geoEnd.lat,
          canvasStart.x, canvasStart.y,
          canvasEnd.x, canvasEnd.y,
          i * 100,
        );

        const midIdx = Math.floor(seg.polylineCoordinates.length / 2);
        midpoint = projectPolylinePoint(
          seg.polylineCoordinates[midIdx][0], seg.polylineCoordinates[midIdx][1],
          geoStart.lng, geoStart.lat,
          geoEnd.lng, geoEnd.lat,
          canvasStart.x, canvasStart.y,
          canvasEnd.x, canvasEnd.y,
        );
      } else {
        pathD = 'M' + canvasStart.x.toFixed(1) + ',' + canvasStart.y.toFixed(1) + ' L' + canvasEnd.x.toFixed(1) + ',' + canvasEnd.y.toFixed(1);
        midpoint = { x: (canvasStart.x + canvasEnd.x) / 2, y: (canvasStart.y + canvasEnd.y) / 2 };
      }

      // Compute path pixel length for dynamic text sizing
      const pathPixelLength = computePathPixelLength(pathD);

      // Check if the path goes right-to-left on canvas (text would be upside down)
      const mirrored = isPathMirrored(pathD);

      // Create a separate text path — reversed if mirrored so text reads correctly
      const textPathD = mirrored ? reversePathD(pathD) : pathD;
      const textPathId = 'route-text-path-' + i;

      // Build dynamic text: "序号 - 距离 · 时长", trimming progressively
      const numberStr = String(i + 1);
      const distStr = formatDistance(seg.distanceInMeters);
      const durStr = formatDuration(seg.durationInSeconds);

      const fullText = numberStr + ' - ' + distStr + ' \u00B7 ' + durStr;
      const noDurText = numberStr + ' - ' + distStr;

      // ~6px per char at fontSize 10; available space is 35% of path (between 10%–45% or 55%–90%)
      // Minimum path length to show any text: 80px
      const charW = 6;
      const availablePx = pathPixelLength * 0.35;

      let displayText: string;
      let hasText = false;
      if (pathPixelLength >= 80 && fullText.length * charW <= availablePx) {
        displayText = fullText;
        hasText = true;
      } else if (pathPixelLength >= 80 && noDurText.length * charW <= availablePx) {
        displayText = noDurText;
        hasText = true;
      } else {
        displayText = '';
      }

      // For mirrored paths, place text at 90% with textAnchor="end" (near original start)
      // For normal paths, place text at 10% with textAnchor="start"
      const textStartOffset = mirrored ? '90%' : '10%';
      const textAnchor = mirrored ? 'end' : 'start';

      return {
        pathD,
        pathId,
        textPathD,
        textPathId,
        textStartOffset,
        textAnchor,
        midpoint,
        color: modeColor,
        number: i + 1,
        routeText: displayText,
        hasText,
      };
    });

    // Build marker points — circles at coordinates + text labels offset nearby
    const computedPoints = projectedPoints.map((p, i) => {
      const pt = allPoints[i];
      const color = getPointColor(pt);

      const name = pt.label;
      const arrival = pt.type === 'poi' ? pt.arrival : undefined;
      // Estimate label dimensions
      const nameW = Math.min(name.length * 8 + 24, 200);
      const arrivalW = arrival ? Math.min(arrival.length * 7 + 24, 100) : 0;
      const totalW = Math.max(nameW, arrivalW);
      const totalH = arrival ? 36 : 20;

      // Smart label placement — offset from the circle at (p.x, p.y)
      const labelPos = findLabelPlacement(p.x, p.y, totalW, totalH, W, H, usedRects);
      usedRects.push({ x: labelPos.x, y: labelPos.y, w: totalW, h: totalH });

      return {
        x: p.x,
        y: p.y,
        color,
        name,
        arrival,
        isStart: pt.type === 'start',
        isEnd: pt.type === 'end',
        labelX: labelPos.x,
        labelY: labelPos.y,
        labelW: totalW,
        labelH: totalH,
      };
    });

    // Build dynamic legend items
    const legendItems: { label: string; color: string; type: 'line' | 'circle' }[] = [];

    for (const mode of modeOrder) {
      if (usedModes.has(mode)) {
        legendItems.push({
          label: TRANSPORT_LABELS[mode] ?? mode,
          color: colorMap.get('mode:' + mode) ?? '#78716c',
          type: 'line',
        });
      }
    }

    legendItems.push({
      label: '景点',
      color: colorMap.get('type:poi') ?? '#78716c',
      type: 'circle',
    });
    if (hasRestaurant) {
      legendItems.push({
        label: '餐厅',
        color: colorMap.get('type:restaurant') ?? '#78716c',
        type: 'circle',
      });
    }
    legendItems.push({
      label: '结束地',
      color: colorMap.get('type:end') ?? '#78716c',
      type: 'circle',
    });

    const legendTransform = 'translate(12, 30)';

    return {
      svgWidth: W,
      svgHeight: H,
      paths: computedPaths,
      points: computedPoints,
      legendItems,
      legendTransform,
    };
  }, [stops, segments, startLocation, endLocation, startLatitude, startLongitude, endLatitude, endLongitude, _costBreakdown]);

  return (
    <svg
      viewBox={'0 0 ' + svgMeta.svgWidth + ' ' + svgMeta.svgHeight}
      className="w-full h-full"
      style={{ fontFamily: '"Caveat", "Patrick Hand", cursive' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Clean paper background */}
      <rect width={svgMeta.svgWidth} height={svgMeta.svgHeight} fill="#faf8f5" />

      {/* Subtle border */}
      <rect
        x="3" y="3"
        width={svgMeta.svgWidth - 6}
        height={svgMeta.svgHeight - 6}
        fill="none"
        stroke="#d6d3d1"
        strokeWidth="1"
        rx="4"
      />

      {/* === Layer 1: Routes (drawn first so they go under circles) === */}
      {svgMeta.paths.map((seg) => (
        <g key={'seg-' + seg.number}>
          {/* Hidden text path — follows the correct direction for textPath rendering */}
          <path
            d={seg.textPathD}
            fill="none"
            stroke="none"
            id={seg.textPathId}
          />

          {/* Main route line */}
          <path
            d={seg.pathD}
            fill="none"
            stroke={seg.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.75"
            id={seg.pathId}
          />
          {/* Thin accent line for hand-drawn feel */}
          <path
            d={seg.pathD}
            fill="none"
            stroke={seg.color}
            strokeWidth="0.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.35"
            strokeDasharray="3 5"
          />

          {/* Number badge at midpoint */}
          <circle
            cx={seg.midpoint.x}
            cy={seg.midpoint.y}
            r="8"
            fill={seg.color}
            stroke="#faf8f5"
            strokeWidth="1.5"
            opacity="0.85"
          />
          <text
            x={seg.midpoint.x}
            y={seg.midpoint.y + 0.5}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="9"
            fontWeight="bold"
            opacity="0.95"
          >
            {seg.number}
          </text>

          {/* Route text — along a reversed path if mirrored so text reads correctly */}
          {seg.hasText && (
            <text fill="#57534e" fontSize="10" fontWeight="500" opacity="0.85">
              <textPath href={'#' + seg.textPathId} startOffset={seg.textStartOffset} textAnchor={seg.textAnchor as 'start' | 'end'}>
                {'  ' + seg.routeText + '  '}
              </textPath>
            </text>
          )}
        </g>
      ))}

      {/* === Layer 2: Point circles (drawn on top of routes) === */}
      {svgMeta.points.map((p, i) => (
        <g key={'pt-' + i}>
          {/* Circle marker at coordinate point */}
          <circle
            cx={p.x}
            cy={p.y}
            r="5"
            fill={p.color}
            stroke="#1c1917"
            strokeWidth="1.5"
          />

          {/* Label background — offset from circle, semi-transparent so it's readable over routes */}
          <rect
            x={p.labelX}
            y={p.labelY}
            width={p.labelW}
            height={p.labelH}
            fill="rgba(250, 248, 245, 0.92)"
            rx="3"
            stroke="#e7e5e4"
            strokeWidth="0.5"
          />
          {/* Name — colored by type */}
          <text
            x={p.labelX + 4}
            y={p.labelY + (p.arrival ? 14 : 14)}
            fill={p.color}
            fontSize="14"
            fontWeight="700"
          >
            {p.name}
          </text>
          {/* Arrival time subtitle */}
          {p.arrival && (
            <text
              x={p.labelX + 4}
              y={p.labelY + 30}
              fill="#78716c"
              fontSize="11"
              fontWeight="500"
            >
              {'~' + p.arrival}
            </text>
          )}
        </g>
      ))}

      {/* === Layer 3: Legend at top-left === */}
      <g transform={svgMeta.legendTransform}>
        <rect
          x="-8" y="-8"
          width="120"
          height={svgMeta.legendItems.length * 22 + 12}
          fill="#faf8f5"
          rx="3"
          stroke="#d6d3d1"
          strokeWidth="1"
        />
        {svgMeta.legendItems.map((item, idx) => (
          <g key={'lg-' + idx} transform={'translate(0, ' + (idx * 22) + ')'}>
            {item.type === 'line' ? (
              <line
                x1="0" y1="4" x2="14" y2="4"
                stroke={item.color}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            ) : (
              <circle
                cx="7" cy="4" r="4"
                fill={item.color}
                stroke="#1c1917"
                strokeWidth="1.5"
              />
            )}
            <text x="22" y="7" fill="#44403c" fontSize="12" fontWeight="500">
              {item.label}
            </text>
          </g>
        ))}
      </g>

      {/* Title */}
      <text
        x={svgMeta.svgWidth / 2} y="18"
        textAnchor="middle"
        fill="#44403c"
        fontSize="14"
        fontWeight="600"
      >
        出行路线简图
      </text>
      <line
        x1={svgMeta.svgWidth / 2 - 40}
        y1="22"
        x2={svgMeta.svgWidth / 2 + 40}
        y2="22"
        stroke="#44403c"
        strokeWidth="0.8"
        opacity="0.4"
      />
    </svg>
  );
}