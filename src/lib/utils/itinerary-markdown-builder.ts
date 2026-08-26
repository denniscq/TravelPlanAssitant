import {
  ItineraryStop,
  RouteSegment,
  TransitLegDetail,
  CostBreakdown,
} from '../types/itinerary-types';
import { isRestaurantPoi } from '../types/poi-types';

/**
 * Format metres as "X.X 公里" (>= 1km) or "X 米".
 */
function formatDistance(meters: number): string {
  if (meters >= 1000) return (meters / 1000).toFixed(1) + ' 公里';
  return Math.round(meters) + ' 米';
}

/**
 * Format seconds as "X 分钟" (< 60min) or "X 小时 Y 分钟".
 */
function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h + ' 小时 ' + m + ' 分钟';
  }
  return minutes + ' 分钟';
}

/**
 * Map transport mode to the Chinese display label used in the markdown.
 */
function modeLabel(mode: RouteSegment['transportMode']): string {
  switch (mode) {
    case 'driving': return '驾车';
    case 'walking': return '步行';
    case 'cycling': return '骑行';
    case 'transit': return '公交/地铁';
    case 'taxi': return '打车';
    default: return mode;
  }
}

function legTypeLabel(type: TransitLegDetail['transportType']): string {
  switch (type) {
    case 'subway': return '地铁';
    case 'railway': return '火车';
    case 'bus': return '公交';
    default: return type;
  }
}

/**
 * Build the "怎么去" sentence for one segment, e.g.:
 *   "驾车 约 8.5 公里 / 30 分钟"
 *   "乘坐【地铁 1 号】从【星海广场】上车 → 【大连北站】下车，经 11 站"
 *   "接驳步行 320 米 / 5 分钟"
 *
 * This is the EXACT data the map shows on each segment badge — there is no
 * way for the LLM to drift the endpoint names away from what the segments
 * actually contain, so image and text match by construction.
 */
function describeTransport(seg: RouteSegment): string {
  const parts: string[] = [];

  if (seg.transportMode === 'transit' && seg.transitLegs && seg.transitLegs.length > 0) {
    for (const leg of seg.transitLegs) {
      const via = leg.viaStopCount > 0 ? `，经 ${leg.viaStopCount} 站` : '';
      parts.push(
        `乘坐【${legTypeLabel(leg.transportType)} ${leg.lineName}】` +
        `从【${leg.departureStopName}】上车 → 【${leg.arrivalStopName}】下车${via}`,
      );
    }
  } else {
    parts.push(
      `${modeLabel(seg.transportMode)} 约 ${formatDistance(seg.distanceInMeters)} / ${formatDuration(seg.durationInSeconds)}`,
    );
  }

  if (seg.walkingLegs && seg.walkingLegs.length > 0) {
    for (const walk of seg.walkingLegs) {
      parts.push(
        `接驳步行 ${Math.round(walk.distanceMeters)} 米 / ${formatDuration(walk.durationSeconds)}`,
      );
    }
  }

  if (seg.transitFee !== undefined && seg.transitFee > 0) {
    parts.push(`票价 ¥${seg.transitFee.toFixed(0)}`);
  }

  return parts.join('；');
}

export interface MarkdownBuildInput {
  startLocation: string;
  endLocation: string;
  /** Ordered stops (POIs in visit order). */
  stops: ItineraryStop[];
  /** Real segments between consecutive stops (length = stops.length + 1). */
  segments: RouteSegment[];
  /** Per-stop ticket cost (for attractions) or average meal cost (for restaurants). */
  costBreakdown: CostBreakdown;
  /** Sum of segment distance in meters (used in the header). */
  totalDistanceInMeters: number;
  /** Sum of segment duration in seconds (used in the header). */
  totalDurationInSeconds: number;
}

/**
 * Build the markdownPlan from the FINAL ordered stops + real segments.
 *
 * This is the source of truth for the user's text description. By building
 * it from the same `stops` + `segments` arrays that the SimplifiedMap uses
 * to draw the diagram, the diagram and the text are guaranteed to refer to
 * the same endpoints, distances, durations, and transport modes — they
 * cannot drift out of sync, regardless of what the LLM returns.
 *
 * The LLM contributes only the per-stop `notes` (what to see/eat/tips) and
 * the per-stop cost figure. Those are stop-local and don't depend on
 * ordering, so they cannot introduce a mismatch.
 */
export function buildItineraryMarkdown(input: MarkdownBuildInput): string {
  const { startLocation, endLocation, stops, segments, costBreakdown,
    totalDistanceInMeters, totalDurationInSeconds } = input;

  const lines: string[] = [];

  // ---------- Header / Overview ----------
  lines.push('### 出行计划');
  lines.push('');
  lines.push('#### 总览');
  lines.push(`- 出发地：${startLocation}`);
  lines.push(`- 结束地：${endLocation}`);
  lines.push(`- 行程站点：${stops.length} 个`);
  lines.push(`- 总行程：${formatDistance(totalDistanceInMeters)} / ${formatDuration(totalDurationInSeconds)}`);
  lines.push(`- 预计总花费：¥${costBreakdown.total}（门票 ¥${costBreakdown.tickets} + 餐饮 ¥${costBreakdown.meals} + 交通 ¥${costBreakdown.transportation}）`);
  lines.push('');

  // ---------- Per-stop detail ----------
  lines.push('#### 行程详情');
  lines.push('');

  // segments[k] travels from routePoints[k] to routePoints[k+1]:
  //   routePoints = [start, ...stops, end]
  // So for stop[i] (0 <= i < stops.length), the INCOMING segment is
  // segments[i] (from start if i==0, else from stops[i-1]).
  // For the very last stop (i = stops.length - 1), segments[i] is the
  // segment from stops[i-1] to stops[i] — NOT the segment to end.
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const poi = stop.poi;
    const seg = segments[i]; // segment INTO this stop
    const headingFrom = i === 0 ? startLocation : stops[i - 1].poi.name;

    // ----- Stop header -----
    lines.push(
      `##### 第${stop.order}站：${stop.suggestedArrivalTime} - ${poi.name}` +
      `（⏰ ${stop.suggestedDurationMinutes} 分钟）`,
    );

    // ----- 怎么去 -----
    if (seg !== undefined) {
      lines.push(`- **怎么去**：从 ${headingFrom} 出发，${describeTransport(seg)}`);
    }

    // ----- 玩什么 / 吃什么 -----
    const heading = poi.category === 'restaurant' ? '吃什么' : '玩什么';
    const noteFromLlm = (stop.notes ?? '').trim();
    if (noteFromLlm.length > 0) {
      lines.push(`- **${heading}**：${noteFromLlm}`);
    } else {
      if (isRestaurantPoi(poi) && poi.recommendedDishes.length > 0) {
        lines.push(`- **吃什么**：推荐菜：${poi.recommendedDishes.join('、')}`);
      } else {
        lines.push(`- **${heading}**：${poi.address}`);
      }
    }

    // ----- 花费 -----
    if (poi.category === 'restaurant') {
      lines.push(`- **花费**：人均 ¥${poi.cost}`);
    } else if (poi.cost > 0) {
      lines.push(`- **花费**：门票 ¥${poi.cost}`);
    } else {
      lines.push('- **花费**：免费');
    }

    lines.push('');
  }

  // ---------- Final leg back to end location ----------
  const lastSeg = segments[segments.length - 1];
  if (lastSeg !== undefined && stops.length > 0) {
    lines.push(`##### 返回：${stops[stops.length - 1].poi.name} → ${endLocation}`);
    lines.push(`- **怎么回**：${describeTransport(lastSeg)}`);
    lines.push('');
  }

  // ---------- Cost breakdown ----------
  lines.push('#### 费用预估明细');
  lines.push(`- 景点门票：¥${costBreakdown.tickets}`);
  lines.push(`- 餐饮：¥${costBreakdown.meals}`);
  lines.push(`- 交通：¥${costBreakdown.transportation}`);
  lines.push(`- **合计**：¥${costBreakdown.total}`);

  return lines.join('\n');
}