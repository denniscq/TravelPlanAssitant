import { PoiItem } from './poi-types';

export type TransportMode = 'driving' | 'walking' | 'transit' | 'cycling';

export interface RouteSegment {
  originIndex: number;
  destinationIndex: number;
  originPoiId: string;
  destinationPoiId: string;
  distanceInMeters: number;
  durationInSeconds: number;
  transportMode: TransportMode;
  polylineCoordinates: [number, number][];
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