'use client';

import { useMemo } from 'react';
import {
  ItineraryStop,
  RouteSegment,
  CostBreakdown,
} from '../../lib/types/itinerary-types';
import {
  formatDistance,
  formatDuration,
  deterministicTilt,
  rectsOverlap,
  labelEdgePoint,
  segmentsIntersect,
  clamp,
  clampRectToCanvas,
  placeLabel,
  bestEffortLabel,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  LabelRect,
  PlacedLabel,
} from './map-helpers';

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

const SEGMENT_BADGE_RADIUS = 11;
const LABEL_PAD_X = 10;
const LABEL_PAD_Y = 6;
const FONT_FAMILY = "'Caveat', 'Comic Sans MS', cursive";
// Chinese chars render wider than Caveat's Latin glyphs; 14 px font + 1.05
// line-height gives a consistent visual rhythm and predictable wrapping.
const LABEL_FONT_PX = 14;
const LABEL_LINE_HEIGHT = 18;
// Wrap label text after this many characters so very long Chinese names
// stay inside the box instead of overflowing.
const MAX_CHARS_PER_LINE = 6;
// Maximum number of wrapped lines a label may occupy. Combined with
// MAX_CHARS_PER_LINE this caps label content at MAX_LABEL_CHARS_TOTAL chars
// (anything longer is truncated with an ellipsis on the last allowed line).
const MAX_LABEL_LINES = 3;
// Maximum total characters a label may display (wraps x lines). If the POI
// name exceeds this, the visible string is truncated.
const MAX_LABEL_CHARS_TOTAL = MAX_CHARS_PER_LINE * MAX_LABEL_LINES;
// Minimum gap (pixels) between two placed labels. Used by the de-overlap
// pass to ensure segment badges / distance labels have room to render.
// Sized as badge diameter + small buffer so two adjacent label rects leave
// room for a centered badge between them.
const MIN_LABEL_GAP = SEGMENT_BADGE_RADIUS * 2 + 8; // = 30
// Approximate pixel width of one character at LABEL_FONT_PX. Chinese glyphs
// are roughly square so this is conservative for both Chinese and Latin.
const CHAR_WIDTH_PX = 14;

const TRANSPORT_MODE_COLORS: Record<string, string> = {
  driving: '#c96d24',
  taxi: '#f97316',
  walking: '#22c55e',
  transit: '#3b82f6',
  cycling: '#a855f7',
};

const TRANSPORT_MODE_LABELS: Record<string, string> = {
  driving: '驾车',
  taxi: '打车',
  walking: '步行',
  transit: '公交',
  cycling: '骑行',
};

const POI_PALETTE = [
  '#0891b2',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#6366f1',
  '#ef4444',
  '#14b8a6',
  '#8b5cf6',
  '#84cc16',
  '#f97316',
];

const START_END_COLOR = '#a855f7';
const RESTAURANT_COLOR = '#d97706';

interface RenderableNode {
  id: string;
  /** Center of the label — also the "anchor" that segments connect to. */
  cx: number;
  cy: number;
  /** Filled rectangle for the note-paper label. */
  labelRect: LabelRect;
  label: string;
  /** Pre-wrapped label lines (with ellipsis if truncated) — the renderer
   *  should use this directly so truncation is consistent across placement
   *  and rendering. */
  wrappedLines: string[];
  subtitle: string;
  /** Sequence order (1..N) for stops; null for start/end. */
  order: number | null;
  /** Fill color for the order badge / accent stripe. */
  fill: string;
  stroke: string;
  labelRotation: number;
  isStart: boolean;
  isEnd: boolean;
  isRestaurant: boolean;
  /** Projected anchor (real geographic position) — kept so the global
   *  de-overlap pass can fall back to it when iterations don't converge. */
  anchorX: number;
  anchorY: number;
  /** Pinned = start / end POIs that must NOT move during de-overlap. */
  pinned: boolean;
}

interface RenderableSegment {
  fromId: string;
  toId: string;
  color: string;
  mode: string;
  infoText: string;
  /** Where the line emerges from the "from" label's border. */
  fromEdge: { x: number; y: number };
  /** Where the line enters the "to" label's border. */
  toEdge: { x: number; y: number };
  badgePos: { x: number; y: number };
  infoPos: { x: number; y: number };
}

function buildPoiId(stop: ItineraryStop): string {
  return 'poi-' + stop.order + '-' + stop.poi.id;
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
  // Geographic projection — pure lng/lat → canvas pixels. No force
  // simulation: every POI sits exactly where its real-world coordinates
  // project, so cardinal direction (north-up, east-right) is preserved and
  // POIs never appear in the wrong quadrant.
  //
  // Start handling: start is projected to its real location so the user
  // sees where the day began on the map.
  //
  // End handling: when start and end share the same coordinates (typical
  // round trip "hotel → sights → hotel") we collapse them into a single
  // __startEnd__ node at the real location. When they DIFFER, the end is
  // pinned to a fixed corner of the canvas (NOT its real geographic
  // location) because projecting it would put it somewhere in the middle
  // of the map and make it look like just another stop — instead the user
  // needs to see "this purple box in the corner is where the day ends".
  const projected = useMemo(() => {
    const startEndSame =
      Math.abs(startLongitude - endLongitude) < 1e-5 &&
      Math.abs(startLatitude - endLatitude) < 1e-5;

    const points: { lng: number; lat: number; id: string }[] = [];
    if (startEndSame) {
      points.push({ lng: startLongitude, lat: startLatitude, id: '__startEnd__' });
    } else {
      points.push({ lng: startLongitude, lat: startLatitude, id: '__start__' });
    }
    for (const s of stops) {
      points.push({ lng: s.poi.longitude, lat: s.poi.latitude, id: buildPoiId(s) });
    }

    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const p of points) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    const lngSpan = Math.max(maxLng - minLng, 1e-6);
    const latSpan = Math.max(maxLat - minLat, 1e-6);
    // Reserve top-left for the legend and top-right for the compass rose.
    const projectLeft = 165;
    const projectTop = 60;
    const projectRight = CANVAS_WIDTH - 65;
    const projectBottom = CANVAS_HEIGHT - 30;
    const projectW = projectRight - projectLeft;
    const projectH = projectBottom - projectTop;
    // Same scale on both axes so cardinal directions are not warped.
    const scale = Math.min(projectW / lngSpan, projectH / latSpan);
    const offsetX = projectLeft + (projectW - lngSpan * scale) / 2;
    const offsetY = projectTop + (projectH - latSpan * scale) / 2;
    const projectedPois: { id: string; x: number; y: number }[] = points.map((p) => ({
      id: p.id,
      x: offsetX + (p.lng - minLng) * scale,
      // Larger lat (further north) renders higher up (smaller y).
      y: offsetY + (maxLat - p.lat) * scale,
    }));
    const projectedById = new Map<string, { x: number; y: number }>();
    for (const p of projectedPois) projectedById.set(p.id, p);
    // Pin __end__ to a fixed corner of the canvas so it visually reads as
    // "the trip ends here" rather than looking like another POI node in
    // the middle of the route. Bottom-right corner keeps the last
    // segment heading away from the cluster of stops.
    if (!startEndSame) {
      const END_CORNER_X = CANVAS_WIDTH - 80;
      const END_CORNER_Y = CANVAS_HEIGHT - 60;
      projectedById.set('__end__', { x: END_CORNER_X, y: END_CORNER_Y });
    }
    return { projectedById, order: projectedPois.map((p) => p.id) };
  }, [stops, startLatitude, startLongitude, endLatitude, endLongitude]);

  // Expand dense anchor clusters so that labels have room to render.
  // The projection maps POIs to their real geographic positions, which can
  // be very close (< 50 px) when POIs are within 1 km of each other. Label
  // boxes are ~104×66 px, so two anchors this close make label overlap
  // inevitable. This step pushes dense clusters apart while preserving the
  // quadrant relationship (relative to the start point) so the "大方向不能错"
  // constraint is satisfied. Start/end anchors are never moved.
  const expandedProjection = useMemo(() => {
    const MIN_ANCHOR_SEP = 100; // px
    const MAX_ITER = 30;

    // Deep clone so we don't mutate the projected output.
    const newById = new Map(projected.projectedById);

    // Collect POI-only anchors (not start/end) for expansion.
    const isSpecial = (id: string) =>
      id === '__start__' || id === '__end__' || id === '__startEnd__';

    const anchors: { id: string; x: number; y: number }[] = [];
    for (const [id, pos] of newById) {
      if (!isSpecial(id)) {
        anchors.push({ id, x: pos.x, y: pos.y });
      }
    }

    if (anchors.length < 2) {
      return { projectedById: newById, order: projected.order };
    }

    // Get the start anchor for quadrant constraint.
    const startAnchor = newById.get('__start__') ?? newById.get('__startEnd__');

    // Iterative pairwise repulsion until all anchors are at least
    // MIN_ANCHOR_SEP apart.
    for (let iter = 0; iter < MAX_ITER; iter++) {
      let moved = false;
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const dx = anchors[j].x - anchors[i].x;
          const dy = anchors[j].y - anchors[i].y;
          const dist = Math.hypot(dx, dy);
          if (dist >= MIN_ANCHOR_SEP || dist < 1e-6) continue;
          const deficit = MIN_ANCHOR_SEP - dist;
          const ux = dx / dist;
          const uy = dy / dist;
          const half = deficit / 2;
          anchors[i].x -= ux * half;
          anchors[i].y -= uy * half;
          anchors[j].x += ux * half;
          anchors[j].y += uy * half;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Apply quadrant constraint relative to the start point so that
    // no POI crosses a cardinal axis — e.g. a POI that is SW of the
    // start stays SW, never becoming SE or NW.
    if (startAnchor) {
      for (const a of anchors) {
        const orig = projected.projectedById.get(a.id);
        if (!orig) continue;
        const origDx = orig.x - startAnchor.x;
        const origDy = orig.y - startAnchor.y;
        const newDx = a.x - startAnchor.x;
        const newDy = a.y - startAnchor.y;
        // Clamp X if the POI crossed the vertical axis (east ↔ west).
        if (Math.sign(origDx) !== Math.sign(newDx) && Math.abs(origDx) > 1) {
          a.x = startAnchor.x + (origDx > 0 ? 1 : -1) * Math.max(Math.abs(newDx), 5);
        }
        // Clamp Y if the POI crossed the horizontal axis (north ↔ south).
        if (Math.sign(origDy) !== Math.sign(newDy) && Math.abs(origDy) > 1) {
          a.y = startAnchor.y + (origDy > 0 ? 1 : -1) * Math.max(Math.abs(newDy), 5);
        }
      }
    }

    // Update the map with expanded positions.
    for (const a of anchors) {
      newById.set(a.id, { x: a.x, y: a.y });
    }

    return { projectedById: newById, order: projected.order };
  }, [projected]);

  // Build the renderable view-model: each node is a note-paper label centred
  // on its real projected location. Order badges go on the label's left
  // edge, segments connect to the label's edge, not its centre.
  const renderableNodes: RenderableNode[] = useMemo(() => {
    const startEndSame =
      Math.abs(startLongitude - endLongitude) < 1e-5 &&
      Math.abs(startLatitude - endLatitude) < 1e-5;

    interface Spec {
      id: string;
      x: number;
      y: number;
      label: string;
      subtitle: string;
      order: number | null;
      fill: string;
      stroke: string;
      isStart: boolean;
      isEnd: boolean;
      isRestaurant: boolean;
    }

    const specs: Spec[] = [];
    const startAnchor = expandedProjection.projectedById.get('__start__') ?? expandedProjection.projectedById.get('__startEnd__');
    const endAnchor = expandedProjection.projectedById.get('__end__') ?? expandedProjection.projectedById.get('__startEnd__');

    const trimForLabel = (s: string): string =>
      s.length > 10 ? s.slice(0, 9) + '…' : s;

    // CRITICAL node ordering: the renderable node list drives BOTH the
    // segment wiring (seg[i] connects nodes[i] -> nodes[i+1]) and the
    // order badge labels. It must match the real trip order:
    //   [__start__, stop1, stop2, ..., stopN, __end__]
    // Putting __end__ anywhere but LAST shifts every segment one position
    // (seg[0] becomes start -> end, seg[1] end -> stop1, ...), which makes
    // the diagram contradict the textual plan — the "image vs text" bug.
    if (startEndSame) {
      specs.push({
        id: '__startEnd__',
        x: startAnchor?.x ?? CANVAS_WIDTH / 2,
        y: startAnchor?.y ?? CANVAS_HEIGHT / 2,
        label: trimForLabel(startLocation),
        subtitle: '起/终',
        order: null,
        fill: START_END_COLOR,
        stroke: '#1c1917',
        isStart: true,
        isEnd: true,
        isRestaurant: false,
      });
    } else if (startAnchor) {
      specs.push({
        id: '__start__',
        x: startAnchor.x,
        y: startAnchor.y,
        label: trimForLabel(startLocation),
        subtitle: '起点',
        order: null,
        fill: START_END_COLOR,
        stroke: '#1c1917',
        isStart: true,
        isEnd: false,
        isRestaurant: false,
      });
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const id = buildPoiId(stop);
      const anchor = expandedProjection.projectedById.get(id);
      if (!anchor) continue;
      const isRestaurant = stop.poi.category === 'restaurant';
      specs.push({
        id,
        x: anchor.x,
        y: anchor.y,
        label: stop.poi.name,
        subtitle: stop.suggestedArrivalTime ? '约 ' + stop.suggestedArrivalTime : '',
        order: stop.order,
        fill: isRestaurant ? RESTAURANT_COLOR : POI_PALETTE[i % POI_PALETTE.length],
        stroke: '#1c1917',
        isStart: false,
        isEnd: false,
        isRestaurant,
      });
    }

    // __end__ MUST come after all stops so the segment wiring stays aligned
    // with the real route (seg[N] = last stop -> end location).
    if (!startEndSame && endAnchor) {
      specs.push({
        id: '__end__',
        x: endAnchor.x,
        y: endAnchor.y,
        label: trimForLabel(endLocation),
        subtitle: '终点',
        order: null,
        fill: START_END_COLOR,
        stroke: '#1c1917',
        isStart: false,
        isEnd: true,
        isRestaurant: false,
      });
    }

    // Compute label rect dimensions for a POI name.
    //
    // All labels share the SAME maximum rectangle size so the global
    // de-overlap pass (enforceGlobalLabelSeparation) can use simple AABB
    // checks without accounting for varying label sizes. Long names are
    // truncated to fit MAX_LABEL_LINES x MAX_CHARS_PER_LINE = 18 chars; the
    // last allowed line ends with an ellipsis.
    //
    //   - Width  = MAX_CHARS_PER_LINE * CHAR_WIDTH_PX + 2 * LABEL_PAD_X
    //              (always full max — never narrower regardless of content)
    //   - Height = MAX_LABEL_LINES * LABEL_LINE_HEIGHT + subtitleLineHeight
    //              + 2 * LABEL_PAD_Y
    const computeLabelSize = (text: string, hasSubtitle: boolean): { w: number; h: number; lines: string[] } => {
      const lines: string[] = [];
      const chars = Array.from(text); // honour surrogate pairs and emoji if any
      const totalAllowed = MAX_LABEL_CHARS_TOTAL; // 18
      const lastLineReserve = 1; // reserve 1 char for the ellipsis on the last line if truncated

      if (chars.length <= totalAllowed) {
        // No truncation needed — wrap as-is.
        for (let i = 0; i < chars.length; i += MAX_CHARS_PER_LINE) {
          lines.push(chars.slice(i, i + MAX_CHARS_PER_LINE).join(''));
        }
      } else {
        // Truncate to 17 chars across 3 lines, with "…" on the last line.
        const truncated = chars.slice(0, totalAllowed - lastLineReserve).join('');
        for (let i = 0; i < truncated.length; i += MAX_CHARS_PER_LINE) {
          const chunk = truncated.slice(i, i + MAX_CHARS_PER_LINE);
          lines.push(chunk);
        }
        // Last line gets the ellipsis appended (replacing whatever last char).
        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].slice(0, MAX_CHARS_PER_LINE - 1) + '…';
      }

      const w = MAX_CHARS_PER_LINE * CHAR_WIDTH_PX + LABEL_PAD_X * 2;
      const innerH = MAX_LABEL_LINES * LABEL_LINE_HEIGHT + (hasSubtitle ? LABEL_LINE_HEIGHT : 0);
      const h = innerH + LABEL_PAD_Y * 2;
      return { w, h, lines };
    };

    // Pre-compute sizes so we know what we're placing.
    const sized = specs.map((s) => ({
      spec: s,
      size: computeLabelSize(s.label, !!s.subtitle),
    }));

    // Two-pass placement: first try to honour the projected anchor; if
    // that overlaps an existing label, try to slide in 4 directions;
    // otherwise pick the best available spot. After all are placed, run a
    // pairwise de-overlap pass that pushes apart any two rects closer than
    // MIN_LABEL_GAP so segment badges have room to render.
    const placed: PlacedLabel[] = [];
    const result: RenderableNode[] = [];
    for (const { spec, size } of sized) {
      const { w, h } = size;
      let placedPos: { x: number; y: number };
      let pinned: boolean;
      if (spec.isStart) {
        // Pinned: start label sits directly below the projected anchor.
        placedPos = { x: spec.x - w / 2, y: spec.y + 4 };
        pinned = true;
      } else if (spec.isEnd) {
        // Pinned: end label sits directly above the projected anchor.
        placedPos = { x: spec.x - w / 2, y: spec.y - h - 4 };
        pinned = true;
      } else {
        placedPos =
          placeLabel(spec.x, spec.y, w, h, placed) ??
          bestEffortLabel(spec.x, spec.y, w, h, placed);
        pinned = false;
      }
      // Pin the rect inside the canvas (4px buffer) even for pinned nodes so
      // that the start/end label doesn't end up partially off-canvas when the
      // projected anchor is near an edge.
      const pinnedRect: LabelRect = {
        x: clamp(placedPos.x, 4, CANVAS_WIDTH - w - 4),
        y: clamp(placedPos.y, 4, CANVAS_HEIGHT - h - 4),
        w,
        h,
      };
      placed.push({ rect: pinnedRect, anchorX: spec.x, anchorY: spec.y });
      result.push({
        id: spec.id,
        cx: pinnedRect.x + pinnedRect.w / 2,
        cy: pinnedRect.y + pinnedRect.h / 2,
        labelRect: pinnedRect,
        label: spec.label,
        wrappedLines: size.lines,
        subtitle: spec.subtitle,
        order: spec.order,
        fill: spec.fill,
        stroke: spec.stroke,
        labelRotation: deterministicTilt(spec.id),
        isStart: spec.isStart,
        isEnd: spec.isEnd,
        isRestaurant: spec.isRestaurant,
        anchorX: spec.x,
        anchorY: spec.y,
        pinned,
      });
    }

    return result;
  }, [stops, expandedProjection, startLocation, endLocation, startLatitude, startLongitude, endLatitude, endLongitude]);

  // Global pairwise de-overlap pass. Runs BEFORE the segment-following
  // pass because: (a) it must catch collisions between non-adjacent nodes
  // (e.g. two restaurants near the same anchor), (b) pinned start/end nodes
  // need weight = Infinity so the iterative solver never moves them.
  //
  // The push direction matters: we split along the axis with the LARGER
  // AABB overlap (X or Y). Centroid-to-centroid pushes often leave residual
  // overlap on the axis that actually collides — users see two label boxes
  // still touching each other. Splitting on the dominant axis clears the
  // visible collision every iteration. Iterates up to 16 times and snaps
  // non-pinned labels back to their anchor if the solver does not converge
  // — preserving the geographic layout the user expects to see.
  const labelSeparatedNodes: RenderableNode[] = useMemo(() => {
    if (renderableNodes.length < 2) return renderableNodes;
    const MAX_GLOBAL_ITER = 16;
    const nodes: RenderableNode[] = renderableNodes.map((n) => ({
      ...n,
      labelRect: { ...n.labelRect },
    }));
    for (let iter = 0; iter < MAX_GLOBAL_ITER; iter++) {
      let totalOverlap = 0;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const ar = a.labelRect;
          const br = b.labelRect;
          const ax = ar.x + ar.w / 2;
          const ay = ar.y + ar.h / 2;
          const bx = br.x + br.w / 2;
          const by = br.y + br.h / 2;

          // AABB overlap on either axis.
          const overlapX =
            Math.max(0, Math.min(ar.x + ar.w, br.x + br.w) - Math.max(ar.x, br.x));
          const overlapY =
            Math.max(0, Math.min(ar.y + ar.h, br.y + br.h) - Math.max(ar.y, br.y));
          const aabbOverlap = overlapX > 0 && overlapY > 0;
          // Centre distance check for nearby (non-overlapping) labels — keeps
          // a MIN_LABEL_GAP buffer so segment badges can render between them.
          const dxC = bx - ax;
          const dyC = by - ay;
          const distC = Math.hypot(dxC, dyC);
          const tooClose = !aabbOverlap && distC < MIN_LABEL_GAP && distC > 1e-3;

          if (!aabbOverlap && !tooClose) continue;

          // Weight: pinned = Infinity (never move); restaurant = 0.7
          // (lighter); attraction = 1.0 (default). If both are pinned,
          // the conflict cannot be resolved by the solver — skip.
          const wA = a.pinned ? Infinity : a.isRestaurant ? 0.7 : 1.0;
          const wB = b.pinned ? Infinity : b.isRestaurant ? 0.7 : 1.0;
          if (!isFinite(wA + wB)) continue;

          // Choose push direction: axis with the larger AABB overlap wins;
          // for "too close" pairs pick the axis where the gap is smallest.
          let ux = 0;
          let uy = 0;
          let required = 0;
          if (aabbOverlap) {
            if (overlapX >= overlapY) {
              ux = ax < bx ? -1 : 1;
              required = overlapX;
            } else {
              uy = ay < by ? -1 : 1;
              required = overlapY;
            }
          } else {
            // tooClose: push apart along the axis where they are closer.
            if (Math.abs(dxC) >= Math.abs(dyC)) {
              ux = dxC >= 0 ? -1 : 1;
              required = MIN_LABEL_GAP - distC;
            } else {
              uy = dyC >= 0 ? -1 : 1;
              required = MIN_LABEL_GAP - distC;
            }
          }
          if (required <= 0) continue;
          totalOverlap += required;

          const totalW = wA + wB;
          const shareA = wB / totalW; // lighter mover -> larger share
          const shareB = wA / totalW;

          a.labelRect = clampRectToCanvas(
            {
              ...ar,
              x: ar.x + ux * required * shareA,
              y: ar.y + uy * required * shareA,
            },
            ar.w,
            ar.h,
          );
          b.labelRect = clampRectToCanvas(
            {
              ...br,
              x: br.x - ux * required * shareB,
              y: br.y - uy * required * shareB,
            },
            br.w,
            br.h,
          );
        }
      }
      if (totalOverlap < 1) {
        return nodes.map((n) => ({
          ...n,
          cx: n.labelRect.x + n.labelRect.w / 2,
          cy: n.labelRect.y + n.labelRect.h / 2,
        }));
      }
    }
    // Did not converge — snap non-pinned nodes back to their anchor so the
    // user still sees the geographic layout, even if some labels stack.
    return nodes.map((n) =>
      n.pinned
        ? n
        : {
            ...n,
            labelRect: {
              ...n.labelRect,
              x: clamp(n.anchorX - n.labelRect.w / 2, 4, CANVAS_WIDTH - n.labelRect.w - 4),
              y: clamp(n.anchorY - n.labelRect.h / 2, 4, CANVAS_HEIGHT - n.labelRect.h - 4),
            },
            cx: n.anchorX,
            cy: n.anchorY,
          },
    );
  }, [renderableNodes]);

  // Build renderable segments. Each segment connects the label edge of two
  // adjacent nodes (not their centres), so the route looks like a metro line
  // slipping into station "boxes". Badge + info sit on the segment midpoint.
  //
  // After building, run a **path-following de-overlap pass**: for each
  // adjacent pair of nodes, ensure their centres are far enough apart
  // along the segment direction to fit the badge + info label without
  // occlusion. If they're too close, slide them apart along the segment
  // direction. Then recompute the segment edges/badges from the new
  // positions.
  const renderableSegments: RenderableSegment[] = useMemo(() => {
    if (labelSeparatedNodes.length < 2) return [];

    // First pass: compute infoText for each segment so we know the
    // minimum spacing to enforce.
    const prelim = labelSeparatedNodes.map((n, i) => ({
      node: n,
      infoText:
        i < segments.length
          ? formatDistance(segments[i].distanceInMeters) +
            ' · ' +
            formatDuration(segments[i].durationInSeconds)
          : '',
    }));

    // Per-segment required edge-to-edge spacing along the line direction.
    // We measure the gap between the two label *rectangles* (not just the
    // centres) so the badge and info text never get covered by either
    // label. The required gap = info-label width + badge diameter + padding.
    const SEGMENT_RESERVE_PADDING = 24;
    const BADGE_DIAMETER = SEGMENT_BADGE_RADIUS * 2;
    // Minimum edge-to-edge gap between two adjacent labels along the segment
    // direction. We only need to clear the badge diameter plus a small visual
    // buffer — the info label sits ABOVE the badge (not between the two POI
    // labels), so there's no need to push labels apart by the full info-label
    // width. Keeping this number small lets the line stay visually connected
    // to the "from" label rather than floating in mid-air.
    const computeRequiredEdgeGap = (_infoText: string): number => {
      return BADGE_DIAMETER + 8; // = 30 — just enough room for the circle
    };

    // Project two label rectangles onto the (ux, uy) unit vector from A
    // to B, returning (aMaxAlong, bMinAlong) — the furthest A-rect point
    // along the direction and the nearest B-rect point. The geometric
    // edge-to-edge gap is bMinAlong - aMaxAlong.
    const rectProjectionsAlong = (
      aRect: LabelRect,
      aCx: number,
      aCy: number,
      bRect: LabelRect,
      bCx: number,
      bCy: number,
      ux: number,
      uy: number,
    ): { aMax: number; bMin: number; gap: number } => {
      const projectRect = (
        rect: LabelRect,
        cx: number,
        cy: number,
        sign: 1 | -1,
      ): number => {
        // Find the corner furthest in the direction (sign*ux, sign*uy)
        // measured from (cx, cy). We approximate by sampling the 4
        // corners; for axis-aligned rectangles that's exact.
        const corners: Array<[number, number]> = [
          [rect.x, rect.y],
          [rect.x + rect.w, rect.y],
          [rect.x, rect.y + rect.h],
          [rect.x + rect.w, rect.y + rect.h],
        ];
        let best = -Infinity;
        for (const [px, py] of corners) {
          const v = (px - cx) * ux + (py - cy) * uy;
          const signed = sign === 1 ? v : -v;
          if (signed > best) best = signed;
        }
        return best;
      };
      // Use label centres as the origin — that way A's rect and B's rect
      // are evaluated consistently even when their cx/cy has drifted.
      void aCx;
      void aCy;
      void bCx;
      void bCy;
      const aMax = projectRect(aRect, 0, 0, 1);
      const bMin = -projectRect(bRect, 0, 0, -1);
      const gap = bMin - aMax;
      return { aMax, bMin, gap };
    };

    // Path-following de-overlap using **rect-edge** gap (not centre
    // distance) so that, along the line direction, the two label
    // rectangles leave enough room for the full info label + badge.
    for (let iter = 0; iter < 12; iter++) {
      let moved = false;
      for (let i = 0; i < prelim.length - 1; i++) {
        const a = prelim[i].node;
        const b = prelim[i + 1].node;
        const required = computeRequiredEdgeGap(prelim[i].infoText);
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) continue;
        const ux = dx / dist;
        const uy = dy / dist;
        const { gap } = rectProjectionsAlong(
          a.labelRect, a.cx, a.cy,
          b.labelRect, b.cx, b.cy,
          ux, uy,
        );
        if (gap >= required) continue;
        const deficit = required - gap;
        // Move both rects apart along (ux, uy) by half each.
        const halfPush = deficit / 2;
        const dxa = -ux * halfPush;
        const dya = -uy * halfPush;
        const dxb = ux * halfPush;
        const dyb = uy * halfPush;
        a.cx += dxa;
        a.cy += dya;
        a.labelRect = { ...a.labelRect, x: a.labelRect.x + dxa, y: a.labelRect.y + dya };
        b.cx += dxb;
        b.cy += dyb;
        b.labelRect = { ...b.labelRect, x: b.labelRect.x + dxb, y: b.labelRect.y + dyb };
        moved = true;
      }
      if (!moved) break;
    }

    // Clamp every label inside the canvas so path-pushing never pushes
    // them off-screen.
    for (const p of prelim) {
      p.node.labelRect = {
        ...p.node.labelRect,
        x: Math.max(4, Math.min(CANVAS_WIDTH - p.node.labelRect.w - 4, p.node.labelRect.x)),
        y: Math.max(4, Math.min(CANVAS_HEIGHT - p.node.labelRect.h - 4, p.node.labelRect.y)),
      };
      p.node.cx = Math.max(p.node.labelRect.x, Math.min(p.node.labelRect.x + p.node.labelRect.w, p.node.cx));
      p.node.cy = Math.max(p.node.labelRect.y, Math.min(p.node.labelRect.y + p.node.labelRect.h, p.node.cy));
    }

    // --- Two-pass crossing detection + badge/info placement ---
    //
    // Pass 1: compute all segment edges (fromEdge → toEdge) so we can
    // detect ALL crossing pairs, not just those against already-processed
    // segments. This is critical: when two segments cross, both need
    // adjusted placement, not just the later one.
    const edgeData: {
      fromId: string;
      toId: string;
      fromX: number; fromY: number;
      toX: number;   toY: number;
      color: string;
      mode: string;
      infoText: string;
    }[] = [];
    for (let i = 0; i < prelim.length - 1; i++) {
      const a = prelim[i].node;
      const b = prelim[i + 1].node;
      const seg = segments[i];
      const mode = seg?.transportMode ?? 'driving';
      const color = TRANSPORT_MODE_COLORS[mode] ?? TRANSPORT_MODE_COLORS.driving;
      const infoText = prelim[i].infoText;
      // fromEdge sits on a's label rect (facing b); toEdge sits on b's
      // label rect (facing a). The line travels from a → b so the
      // arrowhead at toEdge correctly points AT the destination.
      const fromEdge = labelEdgePoint(b.cx, b.cy, a.labelRect);
      const toEdge = labelEdgePoint(a.cx, a.cy, b.labelRect);
      edgeData.push({
        fromId: a.id, toId: b.id,
        fromX: fromEdge.x, fromY: fromEdge.y,
        toX: toEdge.x, toY: toEdge.y,
        color, mode, infoText,
      });
    }

    // Detect ALL crossing pairs simultaneously.
    const crossingFlags = new Array<boolean>(edgeData.length).fill(false);
    for (let i = 0; i < edgeData.length; i++) {
      for (let j = i + 1; j < edgeData.length; j++) {
        if (segmentsIntersect(
          edgeData[i].fromX, edgeData[i].fromY, edgeData[i].toX, edgeData[i].toY,
          edgeData[j].fromX, edgeData[j].fromY, edgeData[j].toX, edgeData[j].toY,
        )) {
          crossingFlags[i] = true;
          crossingFlags[j] = true;
        }
      }
    }

    // Pass 2: build final segments with optimal badge/info placement.
    // Strategy:
    //   A) Long + no crossing → midpoint (both badge and info at centre)
    //   B) Long + crossing    → badge at midpoint, info at 25% from from-side
    //   C) Short + no crossing → badge at 1/3, info at 2/3 (staggered)
    //   D) Short + crossing    → badge at 1/4, info at 3/4 (max separation)
    const MIN_VISIBLE_LINE_FOR_MIDPOINT = 90;
    const result: RenderableSegment[] = [];
    for (let i = 0; i < edgeData.length; i++) {
      const e = edgeData[i];
      const lineLen = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
      const crosses = crossingFlags[i];
      const ux = lineLen > 1e-6 ? (e.toX - e.fromX) / lineLen : 1;
      const uy = lineLen > 1e-6 ? (e.toY - e.fromY) / lineLen : 0;

      let badgePos: { x: number; y: number };
      let infoPos: { x: number; y: number };

      if (lineLen >= MIN_VISIBLE_LINE_FOR_MIDPOINT && !crosses) {
        // Case A: clean midpoint
        badgePos = {
          x: (e.fromX + e.toX) / 2,
          y: (e.fromY + e.toY) / 2,
        };
        infoPos = {
          x: badgePos.x,
          y: badgePos.y - SEGMENT_BADGE_RADIUS - 4,
        };
      } else if (lineLen >= MIN_VISIBLE_LINE_FOR_MIDPOINT && crosses) {
        // Case B: badge at midpoint, info at 25% from from-side
        badgePos = {
          x: (e.fromX + e.toX) / 2,
          y: (e.fromY + e.toY) / 2,
        };
        const t = 0.25;
        infoPos = {
          x: e.fromX + ux * t * lineLen,
          y: e.fromY + uy * t * lineLen,
        };
      } else if (lineLen < MIN_VISIBLE_LINE_FOR_MIDPOINT && !crosses) {
        // Case C: staggered along the line
        const badgeT = 0.33;
        const infoT = 0.67;
        badgePos = {
          x: e.fromX + ux * badgeT * lineLen,
          y: e.fromY + uy * badgeT * lineLen,
        };
        infoPos = {
          x: e.fromX + ux * infoT * lineLen,
          y: e.fromY + uy * infoT * lineLen,
        };
      } else {
        // Case D: short + crossing → max separation
        const badgeT = 0.25;
        const infoT = 0.75;
        badgePos = {
          x: e.fromX + ux * badgeT * lineLen,
          y: e.fromY + uy * badgeT * lineLen,
        };
        infoPos = {
          x: e.fromX + ux * infoT * lineLen,
          y: e.fromY + uy * infoT * lineLen,
        };
      }

      result.push({
        fromId: e.fromId,
        toId: e.toId,
        color: e.color,
        mode: e.mode,
        infoText: e.infoText,
        fromEdge: { x: e.fromX, y: e.fromY },
        toEdge: { x: e.toX, y: e.toY },
        badgePos,
        infoPos,
      });
    }
    return result;
  }, [renderableNodes, segments]);

  const transportLegend = useMemo(() => {
    const used = new Set<string>();
    for (const seg of segments) used.add(seg.transportMode);
    return Array.from(used);
  }, [segments]);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden border-2 border-stone-800 bg-[#fefce8] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]">
        <svg
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full"
          role="img"
          aria-label="出行路线简图"
        >
          <title>出行路线简图</title>

          {/* Shared arrow marker for segment endpoints. orient="auto-start-reverse"
              makes the marker rotate with the line direction so the arrow always
              points AT the destination. markerWidth/Height tuned to read clearly
              at the 2.5px line stroke width. */}
          <defs>
            <marker
              id="arrow-end"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>

          {/* Segments — connect the two label edges with a straight line.
              marker-end paints a small arrow head at the "to" endpoint so the
              direction of travel is visible without legend lookup. */}
          {renderableSegments.map((seg, i) => (
            <line
              key={`seg-${i}`}
              x1={seg.fromEdge.x}
              y1={seg.fromEdge.y}
              x2={seg.toEdge.x}
              y2={seg.toEdge.y}
              stroke={seg.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#arrow-end)"
            />
          ))}

          {/* Nodes render as note-paper labels with just the place name
              (and optional time). There are no order badges or endpoint
              tags — those are conveyed by the legend and the purple
              start/end stroke color. */}
          {labelSeparatedNodes.map((n) => {
            // Use the pre-wrapped lines from computeLabelSize — they already
            // honour MAX_LABEL_LINES / ellipsis truncation rules.
            const lines = n.wrappedLines;
            const subtitleRowH = n.subtitle ? LABEL_LINE_HEIGHT : 0;
            const innerH = n.labelRect.h - LABEL_PAD_Y * 2;
            const nameBlockH = innerH - subtitleRowH;
            // Vertically centre the wrapped name block within its slot.
            const nameStartY = LABEL_PAD_Y + (nameBlockH - lines.length * LABEL_LINE_HEIGHT) / 2 + LABEL_LINE_HEIGHT - 4;
            return (
              <g key={n.id}>
                <g
                  transform={`translate(${n.labelRect.x}, ${n.labelRect.y}) rotate(${n.labelRotation})`}
                >
                  <rect
                    x={0}
                    y={0}
                    width={n.labelRect.w}
                    height={n.labelRect.h}
                    rx={2}
                    fill={n.isStart || n.isEnd ? '#f5f3ff' : n.isRestaurant ? '#fff7ed' : '#fffbeb'}
                    stroke={n.isStart || n.isEnd ? '#7c3aed' : n.isRestaurant ? RESTAURANT_COLOR : '#0891b2'}
                    strokeWidth={1.5}
                    style={{ filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.12))' }}
                  />
                  {lines.map((line, idx) => (
                    <text
                      key={idx}
                      x={LABEL_PAD_X}
                      y={nameStartY + idx * LABEL_LINE_HEIGHT}
                      fontSize={14}
                      fontFamily={FONT_FAMILY}
                      fontWeight={600}
                      fill={n.isStart || n.isEnd ? '#5b21b6' : n.isRestaurant ? '#9a3412' : '#155e75'}
                    >
                      {line}
                    </text>
                  ))}
                  {n.subtitle && (
                    <text
                      x={LABEL_PAD_X}
                      y={n.labelRect.h - LABEL_PAD_Y - 2}
                      fontSize={11}
                      fontFamily={FONT_FAMILY}
                      fill="#78716c"
                    >
                      {n.subtitle}
                    </text>
                  )}
                </g>
              </g>
            );
          })}

          {/* Segment badges + info labels — rendered AFTER nodes so they sit
              on the topmost layer. Info labels use a translucent fill
              (~0.85 opacity) so any POI label underneath remains visible
              through them while the route info text stays legible. The
              number badge is fully opaque to keep the route sequence clear. */}
          {renderableSegments.map((seg, i) => (
            <g key={`seg-badge-${i}`}>
              {/* Info label — note-paper, translucent */}
              {seg.infoText && (
                <g transform={`translate(${seg.infoPos.x}, ${seg.infoPos.y})`}>
                  <rect
                    x={-seg.infoText.length * 4.2 - 6}
                    y={-9}
                    width={seg.infoText.length * 4.2 * 2 + 12}
                    height={18}
                    rx={2}
                    fill="#fffbeb"
                    fillOpacity={0.88}
                    stroke="#44403c"
                    strokeWidth={1.2}
                    style={{ filter: 'drop-shadow(1px 1px 0 rgba(0,0,0,0.15))' }}
                  />
                  <text
                    x={0}
                    y={4}
                    textAnchor="middle"
                    fontSize={11}
                    fontFamily={FONT_FAMILY}
                    fill="#44403c"
                    fillOpacity={0.95}
                  >
                    {seg.infoText}
                  </text>
                </g>
              )}
              {/* Number badge — opaque circle on top, NEVER rotated */}
              <g transform={`translate(${seg.badgePos.x}, ${seg.badgePos.y})`}>
                <circle
                  r={SEGMENT_BADGE_RADIUS}
                  fill={seg.color}
                  stroke="#1c1917"
                  strokeWidth={2}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fontFamily={FONT_FAMILY}
                  fill="#fff"
                >
                  {i + 1}
                </text>
              </g>
            </g>
          ))}

          {/* In-canvas legend (top-left corner). Transport modes are shown
              as a coloured line swatch; categories mirror the node label
              style exactly (same fill/stroke/text colour) so the user can
              match a label on the map to its category at a glance. */}
          <g transform="translate(14, 14)">
            {(() => {
              const ITEM_H = 22;
              const ROW_GAP = 6;
              const MINI_W = 28;
              const MINI_H = 16;
              const items: Array<{
                kind: 'mode' | 'category';
                key: string;
                color: string;
                text: string;
                categoryStyle?: { fill: string; stroke: string; textColor: string };
              }> = [
                ...transportLegend.map((mode) => ({
                  kind: 'mode' as const,
                  key: mode,
                  color: TRANSPORT_MODE_COLORS[mode] ?? TRANSPORT_MODE_COLORS.driving,
                  text: TRANSPORT_MODE_LABELS[mode] ?? mode,
                })),
                {
                  kind: 'category',
                  key: 'start-end',
                  color: START_END_COLOR,
                  text: '起/终点',
                  categoryStyle: { fill: '#f5f3ff', stroke: '#7c3aed', textColor: '#5b21b6' },
                },
                {
                  kind: 'category',
                  key: 'poi',
                  color: '#0891b2',
                  text: '景点',
                  // Use a cyan border/text that is distinct from both the
                  // 5 transport-mode colours and the dark-grey used for
                  // segment distance/time labels, so the legend swatch
                  // can't be confused with either category.
                  categoryStyle: { fill: '#fffbeb', stroke: '#0891b2', textColor: '#155e75' },
                },
                {
                  kind: 'category',
                  key: 'restaurant',
                  color: RESTAURANT_COLOR,
                  text: '餐厅',
                  categoryStyle: { fill: '#fff7ed', stroke: RESTAURANT_COLOR, textColor: '#9a3412' },
                },
              ];
              const width = 150;
              const headerH = 24;
              const padding = 10;
              const height = headerH + items.length * ITEM_H + padding;
              return (
                <g>
                  <rect
                    x={0}
                    y={0}
                    width={width}
                    height={height}
                    rx={3}
                    fill="#fffbeb"
                    stroke="#44403c"
                    strokeWidth={1.5}
                    style={{ filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.12))' }}
                  />
                  <text
                    x={padding}
                    y={16}
                    fontSize={12}
                    fontWeight={700}
                    fontFamily={FONT_FAMILY}
                    fill="#44403c"
                  >
                    图例
                  </text>
                  {items.map((item, idx) => (
                    <g key={item.key} transform={`translate(${padding}, ${headerH + idx * ITEM_H + ROW_GAP})`}>
                      {item.kind === 'mode' ? (
                        // Transport mode = coloured line swatch
                        <rect x={0} y={5} width={MINI_W} height={6} fill={item.color} />
                      ) : (
                        // Category = mini-label matching node style exactly
                        <g>
                          <rect
                            x={0}
                            y={2}
                            width={MINI_W}
                            height={MINI_H}
                            rx={2}
                            fill={item.categoryStyle!.fill}
                            stroke={item.categoryStyle!.stroke}
                            strokeWidth={1.2}
                          />
                          <text
                            x={MINI_W / 2}
                            y={14}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily={FONT_FAMILY}
                            fill={item.categoryStyle!.textColor}
                          >
                            {item.text.length > 3 ? item.text.slice(0, 3) : item.text}
                          </text>
                        </g>
                      )}
                      <text
                        x={MINI_W + 8}
                        y={14}
                        fontSize={11}
                        fontFamily={FONT_FAMILY}
                        fill="#1c1917"
                      >
                        {item.text}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}
          </g>

          {/* Compass rose (top-right corner) — north / south in Chinese */}
          <g transform={`translate(${CANVAS_WIDTH - 60}, 14)`}>
            <rect
              x={0}
              y={0}
              width={46}
              height={46}
              rx={3}
              fill="#fffbeb"
              stroke="#44403c"
              strokeWidth={1.5}
              style={{ filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.12))' }}
            />
            <text x={23} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily={FONT_FAMILY} fill="#dc2626">北</text>
            <polygon points="23,18 18,30 28,30" fill="#44403c" />
            <text x={23} y={42} textAnchor="middle" fontSize={11} fontFamily={FONT_FAMILY} fill="#44403c">南</text>
          </g>
        </svg>
      </div>

      {/* Empty placeholder to keep the wrapper layout stable — legend is now in-canvas */}
      <div className="hidden">
        {transportLegend.map((mode) => (
          <div key={mode} className="flex items-center gap-2 font-['Caveat'] text-stone-700">
            <span
              className="inline-block h-3 w-6 rounded-sm"
              style={{ backgroundColor: TRANSPORT_MODE_COLORS[mode] ?? TRANSPORT_MODE_COLORS.driving }}
            />
            {TRANSPORT_MODE_LABELS[mode] ?? mode}
          </div>
        ))}
        <div className="flex items-center gap-2 font-['Caveat'] text-stone-700">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: START_END_COLOR }} />
          起/终点
        </div>
        <div className="flex items-center gap-2 font-['Caveat'] text-stone-700">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: '#0ea5e9' }} />
          景点
        </div>
        <div className="flex items-center gap-2 font-['Caveat'] text-stone-700">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: RESTAURANT_COLOR }} />
          餐厅
        </div>
      </div>
    </div>
  );
}
