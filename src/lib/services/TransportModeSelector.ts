import { TransportMode } from '../types/itinerary-types';
import { ServerLogger } from '../utils/server-logger';
import {
  transitAccessibilityService,
  TransitAccessibilityService,
  TransitAccessibilityInput,
} from './TransitAccessibilityService';

/**
 * Selector rule thresholds. Tunable per requirements:
 *   - Below 1km straight-line distance -> walking (always wins).
 *   - Above 1km AND combined origin/destination-to-station distance <= 1km
 *     -> transit (bus / subway).
 *   - Above 150km single segment -> driving (self-driving / rental car).
 *   - Otherwise -> taxi (ride-hailing / cab).
 */
export const WALKING_MAX_DISTANCE_METERS = 1000;
export const LONG_DISTANCE_THRESHOLD_METERS = 150_000;
export const TRANSIT_COMBINED_THRESHOLD_METERS = 1000;

export interface SegmentEndpoint {
  /** Optional POI name for logging clarity. */
  name?: string;
  longitude: number;
  latitude: number;
}

export interface TransportSegmentInput {
  origin: SegmentEndpoint;
  destination: SegmentEndpoint;
}

export interface TransportDecision {
  /** Final transport mode. */
  mode: TransportMode;
  /** Straight-line distance in meters between origin and destination. */
  straightLineDistanceInMeters: number;
  /** Combined origin/destination-to-station distance, when checked. */
  combinedStationDistanceInMeters: number | null;
  /** Marker for downstream rendering / notes. */
  suggestRental: boolean;
  /** Reason string for logs / debugging. */
  reason: string;
}

export interface DecideOptions {
  /** Override the walking threshold (meters). */
  walkingMaxDistanceMeters?: number;
  /** Override the long-distance threshold (meters). */
  longDistanceThresholdMeters?: number;
  /** Override the transit combined threshold (meters). */
  transitCombinedThresholdMeters?: number;
  /** Injected transit accessibility service (for testing). */
  transitService?: TransitAccessibilityService;
}

/**
 * Pure-logic selector that decides the transport mode for each segment.
 *
 * Rules:
 *   1. Straight-line distance <= 1km -> walking.
 *   2. Combined origin + destination station distance <= 1km -> transit.
 *   3. Straight-line distance > 150km -> driving (suggest rental).
 *   4. Fallback -> taxi.
 *
 * Note: LLM's suggested mode is intentionally ignored per design decision —
 * the selector relies solely on objective geographic data.
 */
export class TransportModeSelector {
  /**
   * Compute decisions for all segments. Segments are processed sequentially
   * because each segment fetches two transit queries; running in parallel
   * could spike the AMap QPS limit on long itineraries.
   */
  public async decideForSegments(
    segments: TransportSegmentInput[],
    logger?: ServerLogger,
    options: DecideOptions = {}
  ): Promise<TransportDecision[]> {
    const walkingMax = options.walkingMaxDistanceMeters ?? WALKING_MAX_DISTANCE_METERS;
    const longDistanceMax = options.longDistanceThresholdMeters ?? LONG_DISTANCE_THRESHOLD_METERS;
    const transitCombinedMax =
      options.transitCombinedThresholdMeters ?? TRANSIT_COMBINED_THRESHOLD_METERS;
    const transitService = options.transitService ?? transitAccessibilityService;

    const decisions: TransportDecision[] = [];

    logger?.info(
      `[TransportModeSelector] deciding ${segments.length} segments ` +
      `(walking<=${walkingMax}m, long>${longDistanceMax}m, transit<=${transitCombinedMax}m)`
    );

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const distance = haversineMeters(
        segment.origin.latitude,
        segment.origin.longitude,
        segment.destination.latitude,
        segment.destination.longitude
      );

      logger?.info(
        `[TransportModeSelector] segment[${i}] ${describeSegment(segment)} ` +
        `distance=${Math.round(distance)}m`
      );

      let decision: TransportDecision;

      // Rule 1: short distance always wins.
      if (distance <= walkingMax) {
        decision = {
          mode: 'walking',
          straightLineDistanceInMeters: distance,
          combinedStationDistanceInMeters: null,
          suggestRental: false,
          reason: `distance ${Math.round(distance)}m <= walking threshold ${walkingMax}m`,
        };
      } else {
        // Rule 2: query transit accessibility (origin + destination in parallel).
        const accessibility = await transitService.checkCombinedAccessibility(
          toAccessibilityInput(segment.origin),
          toAccessibilityInput(segment.destination),
          transitCombinedMax,
          logger
        );

        if (accessibility.feasible) {
          decision = {
            mode: 'transit',
            straightLineDistanceInMeters: distance,
            combinedStationDistanceInMeters: accessibility.combinedDistanceInMeters,
            suggestRental: false,
            reason:
              `transit feasible: combined station distance ` +
              `${Math.round(accessibility.combinedDistanceInMeters)}m ` +
              `<= ${transitCombinedMax}m`,
          };
        } else if (distance > longDistanceMax) {
          // Rule 3: very long single segment.
          decision = {
            mode: 'driving',
            straightLineDistanceInMeters: distance,
            combinedStationDistanceInMeters: accessibility.combinedDistanceInMeters,
            suggestRental: true,
            reason:
              `distance ${Math.round(distance)}m > long-distance threshold ` +
              `${longDistanceMax}m`,
          };
        } else {
          // Rule 4: fallback to taxi (ride-hailing).
          decision = {
            mode: 'taxi',
            straightLineDistanceInMeters: distance,
            combinedStationDistanceInMeters: accessibility.combinedDistanceInMeters,
            suggestRental: false,
            reason:
              `transit not feasible ` +
              `(combined=${Math.round(accessibility.combinedDistanceInMeters)}m), ` +
              `distance ${Math.round(distance)}m within taxi range`,
          };
        }
      }

      logger?.info(
        `[TransportModeSelector] segment[${i}] -> ${decision.mode} ` +
        `(reason: ${decision.reason})`
      );

      decisions.push(decision);
    }

    return decisions;
  }
}

function toAccessibilityInput(endpoint: SegmentEndpoint): TransitAccessibilityInput {
  return { longitude: endpoint.longitude, latitude: endpoint.latitude };
}

function describeSegment(segment: TransportSegmentInput): string {
  const o = segment.origin.name ?? `${segment.origin.latitude.toFixed(4)},${segment.origin.longitude.toFixed(4)}`;
  const d = segment.destination.name ?? `${segment.destination.latitude.toFixed(4)},${segment.destination.longitude.toFixed(4)}`;
  return `${o} -> ${d}`;
}

/**
 * Haversine distance between two geographic points, in meters.
 * Single source of truth — kept here to avoid coupling with other modules.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadius = 6_371_000;
  const toRadians = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const transportModeSelector = new TransportModeSelector();