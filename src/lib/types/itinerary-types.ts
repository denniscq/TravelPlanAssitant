import { PoiItem } from './poi-types';

export type TransportMode = 'driving' | 'walking' | 'transit' | 'cycling' | 'taxi';

/**
 * One ride leg inside a transit itinerary — e.g. "take Metro Line 1 from
 * Tiananmen East to Wangfujing". Sourced from the Amap
 * `/v3/direction/transit/integrated` response's
 * `transits[].segments[].bus.buslines[]` (or `subway.buslines[]`).
 */
export interface TransitLegDetail {
  /** Derived from Amap's `type` field (e.g. "地铁线路" -> 'subway', "公交线路" -> 'bus'). */
  transportType: 'bus' | 'subway' | 'railway';
  /** Verbatim line name from Amap, e.g. "Line 1" or "Route 445". */
  lineName: string;
  /** Boarding stop name from `departure_stop.name`. */
  departureStopName: string;
  /** Alighting stop name from `arrival_stop.name`. */
  arrivalStopName: string;
  /** Number of intermediate stops (from `via_num`). */
  viaStopCount: number;
  /** First-train time in HHMM format, e.g. "0600". */
  startTime: string;
  /** Last-train time in HHMM format, e.g. "2300". */
  endTime: string;
  /** Ride distance in meters (from `distance`). */
  distanceMeters: number;
  /** Ride duration in seconds (from `duration`). */
  durationSeconds: number;
}

/**
 * Walking leg inside a transit itinerary — the "walk to the station" and
 * "walk from the station" segments. Sourced from
 * `transits[].segments[].walking.steps[]`.
 */
export interface WalkingLegDetail {
  distanceMeters: number;
  durationSeconds: number;
  /** Concatenated step instructions for the leg, in Amap's raw text. */
  instruction: string;
}

export interface RouteSegment {
  originIndex: number;
  destinationIndex: number;
  originPoiId: string;
  destinationPoiId: string;
  distanceInMeters: number;
  durationInSeconds: number;
  transportMode: TransportMode;
  polylineCoordinates: [number, number][];
  /** Structured transit legs, only populated when `transportMode === 'transit'`. */
  transitLegs?: TransitLegDetail[];
  /** Total transit fee in yuan, only populated when `transportMode === 'transit'`. */
  transitFee?: number;
  /** First/last walking legs inside a transit itinerary (boarding + alighting transfers). */
  walkingLegs?: WalkingLegDetail[];
}

export interface ItineraryStop {
  order: number;
  poi: PoiItem;
  suggestedArrivalTime: string;
  suggestedDurationMinutes: number;
  transportMode?: string;
  transportDistance?: string;
  transportDuration?: string;
  notes?: string;
}

export interface CostBreakdown {
  tickets: number;
  meals: number;
  transportation: number;
  total: number;
}

export interface ItineraryPlan {
  stops: ItineraryStop[];
  segments: RouteSegment[];
  totalDistanceInMeters: number;
  totalDurationInSeconds: number;
  startLocation: string;
  endLocation: string;
  markdownPlan: string;
  costBreakdown: CostBreakdown;
}

export interface LlmRoutePlanRequest {
  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  endLatitude: number;
  endLongitude: number;
  selectedPois: PoiItem[];
}

export interface LlmRoutePlanResponse {
  orderedPoiIds: string[];
  stopDescriptions: LlmStopDescription[];
  markdownPlan: string;
  costBreakdown: CostBreakdown;
}

export interface LlmStopDescription {
  poiId: string;
  suggestedArrival: string;
  suggestedDuration: string;
  notes: string;
  transportMode?: string;
  transportDistance?: string;
  transportDuration?: string;
  recommendedDishes?: string[];
  ticketPrice?: number;
}

export interface LlmRoutePlanError {
  code: 'RATE_LIMITED' | 'LLM_ERROR' | 'ROUTE_CALCULATION_ERROR' | 'INVALID_RESPONSE';
  message: string;
  retryAfterSeconds?: number;
}