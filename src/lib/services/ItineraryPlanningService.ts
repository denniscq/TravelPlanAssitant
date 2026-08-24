import { PoiItem } from '../types/poi-types';
import {
  ItineraryPlan,
  ItineraryStop,
  LlmRoutePlanRequest,
  LlmRoutePlanError,
  RouteSegment,
  TransportMode,
} from '../types/itinerary-types';
import { llmService } from './LLMService';
import { amapRouteCalculationService } from './AmapRouteCalculationService';
import { ServerLogger } from '../utils/server-logger';

const VALID_TRANSPORT_MODES: ReadonlySet<string> = new Set(['driving', 'walking', 'transit', 'cycling']);

export class ItineraryPlanningService {
  public async generateItinerary(
    startLocation: string,
    startLatitude: number,
    startLongitude: number,
    endLocation: string,
    endLatitude: number,
    endLongitude: number,
    selectedPois: PoiItem[],
    logger?: ServerLogger
  ): Promise<ItineraryPlan | LlmRoutePlanError> {
    logger?.info('========== ITINERARY PLANNING START ==========');
    logger?.info(`Start: ${startLocation} (${startLatitude}, ${startLongitude})`);
    logger?.info(`End: ${endLocation} (${endLatitude}, ${endLongitude})`);
    logger?.info(`Selected POIs count: ${selectedPois.length}`);
    selectedPois.forEach((poi, i) => {
      logger?.info(`  POI[${i}]: id=${poi.id}, name=${poi.name}, category=${poi.category}, lat=${poi.latitude}, lng=${poi.longitude}`);
    });

    if (selectedPois.length < 1) {
      logger?.warn('No POIs selected, returning error');
      return {
        code: 'ROUTE_CALCULATION_ERROR',
        message: 'Please select at least one POI to generate a route.',
      };
    }

    try {
      const llmRequest: LlmRoutePlanRequest = {
        startLocation,
        startLatitude,
        startLongitude,
        endLocation,
        endLatitude,
        endLongitude,
        selectedPois,
      };

      logger?.info('--- Step 1: Calling LLM for route planning ---');
      const llmResponse = await llmService.generateRoutePlan(llmRequest, logger);

      logger?.info('--- Step 2: Ordering POIs by LLM response ---');
      logger?.info(`LLM ordered POI IDs: ${JSON.stringify(llmResponse.orderedPoiIds)}`);
      const orderedPois = this.orderPoisByLlmResponse(selectedPois, llmResponse.orderedPoiIds);
      logger?.info(`Ordered POIs: ${orderedPois.map((p) => p.name).join(' -> ')}`);

      logger?.info('--- Step 3: Building itinerary stops ---');
      const stops: ItineraryStop[] = orderedPois.map((poi, index) => {
        const stopDescription = llmResponse.stopDescriptions.find(
          (desc) => desc.poiId === poi.id
        );

        const stop: ItineraryStop = {
          order: index + 1,
          poi,
          suggestedArrivalTime: stopDescription?.suggestedArrival ?? `${(9 + index * 2).toString().padStart(2, '0')}:00`,
          suggestedDurationMinutes: this.parseDurationToMinutes(
            stopDescription?.suggestedDuration ?? '1.5h'
          ),
          transportMode: stopDescription?.transportMode,
          transportDistance: stopDescription?.transportDistance,
          transportDuration: stopDescription?.transportDuration,
          notes: stopDescription?.notes,
        };

        logger?.info(
          `  Stop[${index + 1}]: ${poi.name} | arrival=${stop.suggestedArrivalTime} | ` +
          `duration=${stop.suggestedDurationMinutes}min | transport=${stop.transportMode ?? 'N/A'}`
        );

        return stop;
      });

      logger?.info('--- Step 4: Building route segment requests ---');
      const routePoints = [
        { latitude: startLatitude, longitude: startLongitude },
        ...orderedPois.map((poi) => ({ latitude: poi.latitude, longitude: poi.longitude })),
        { latitude: endLatitude, longitude: endLongitude },
      ];

      logger?.info(`Route points (${routePoints.length}):`);
      routePoints.forEach((rp, i) => {
        logger?.info(`  Point[${i}]: lat=${rp.latitude.toFixed(6)}, lng=${rp.longitude.toFixed(6)}`);
      });

      // Build per-segment route requests with transport mode from LLM output
      const segmentRequests = this.buildSegmentRequests(routePoints, stops, orderedPois);

      logger?.info(`Segment requests (${segmentRequests.length}):`);
      segmentRequests.forEach((sr, i) => {
        logger?.info(`  Segment[${i}]: mode=${sr.transportMode}, origin=(${sr.origin.latitude.toFixed(6)},${sr.origin.longitude.toFixed(6)}), dest=(${sr.destination.latitude.toFixed(6)},${sr.destination.longitude.toFixed(6)})`);
      });

      logger?.info('--- Step 5: Calculating route segments via Amap API ---');
      const segments = await amapRouteCalculationService.calculateRouteSegments(segmentRequests, logger);

      logger?.info('--- Step 6: Assigning POI IDs to segments ---');
      const segmentsWithPoiIds = this.assignPoiIdsToSegments(segments, orderedPois);

      const totalDistance = segmentsWithPoiIds.reduce(
        (sum, segment) => sum + segment.distanceInMeters,
        0
      );
      const totalDuration = segmentsWithPoiIds.reduce(
        (sum, segment) => sum + segment.durationInSeconds,
        0
      );

      logger?.info('========== ITINERARY PLANNING COMPLETE ==========');
      logger?.info(`  Stops: ${stops.length}`);
      logger?.info(`  Segments: ${segmentsWithPoiIds.length}`);
      logger?.info(`  Total distance: ${totalDistance}m (${(totalDistance / 1000).toFixed(2)}km)`);
      logger?.info(`  Total duration: ${totalDuration}s (${Math.round(totalDuration / 60)}min)`);
      logger?.info(`  Markdown plan length: ${llmResponse.markdownPlan.length} chars`);
      logger?.info(`  Cost breakdown: tickets=${llmResponse.costBreakdown.tickets}, meals=${llmResponse.costBreakdown.meals}, transport=${llmResponse.costBreakdown.transportation}, total=${llmResponse.costBreakdown.total}`);
      logger?.info('');

      return {
        stops,
        segments: segmentsWithPoiIds,
        totalDistanceInMeters: totalDistance,
        totalDurationInSeconds: totalDuration,
        startLocation,
        endLocation,
        markdownPlan: llmResponse.markdownPlan,
        costBreakdown: llmResponse.costBreakdown,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error('========== ITINERARY PLANNING FAILED ==========');
      logger?.error(`  Error: ${errorMsg}`);
      if (error instanceof Error && error.stack !== undefined) {
        logger?.error(`  Stack: ${error.stack}`);
      }

      return {
        code: 'ROUTE_CALCULATION_ERROR',
        message: 'Failed to generate itinerary. Please try again.',
      };
    }
  }

  /**
   * Build per-segment route requests.
   * For each segment i (routePoints[i] -> routePoints[i+1]):
   * - If the destination is a POI (i < stops.length), use stops[i].transportMode
   * - If the destination is the end point (last segment), use the last stop's transportMode
   * - If no transport mode is specified, estimate from straight-line distance
   */
  private buildSegmentRequests(
    routePoints: { latitude: number; longitude: number }[],
    stops: ItineraryStop[],
    orderedPois: PoiItem[]
  ): { origin: { latitude: number; longitude: number }; destination: { latitude: number; longitude: number }; transportMode: TransportMode }[] {
    const requests: { origin: { latitude: number; longitude: number }; destination: { latitude: number; longitude: number }; transportMode: TransportMode }[] = [];

    for (let i = 0; i < routePoints.length - 1; i++) {
      let transportMode: TransportMode = 'driving';

      if (i < stops.length) {
        // Destination is a POI — use transport mode from its stop description
        const modeFromStop = stops[i].transportMode;
        if (modeFromStop !== undefined && modeFromStop !== null && VALID_TRANSPORT_MODES.has(modeFromStop)) {
          transportMode = modeFromStop as TransportMode;
        } else {
          transportMode = this.estimateTransportMode(routePoints[i], routePoints[i + 1]);
        }
      } else {
        // Last segment (last POI -> end) — use last stop's mode or estimate
        const lastStop = stops[stops.length - 1];
        if (lastStop?.transportMode !== undefined && lastStop.transportMode !== null && VALID_TRANSPORT_MODES.has(lastStop.transportMode)) {
          transportMode = lastStop.transportMode as TransportMode;
        } else {
          transportMode = this.estimateTransportMode(routePoints[i], routePoints[i + 1]);
        }
      }

      requests.push({
        origin: routePoints[i],
        destination: routePoints[i + 1],
        transportMode,
      });
    }

    return requests;
  }

  /**
   * Estimate transport mode from straight-line distance between two points.
   * Matches the LLM prompt logic:
   *   <1km -> walking
   *   1-5km -> driving
   *   >5km -> driving
   */
  private estimateTransportMode(
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number }
  ): TransportMode {
    const distanceMeters = this.calculateStraightLineDistance(
      origin.latitude, origin.longitude,
      destination.latitude, destination.longitude
    );

    if (distanceMeters < 1000) {
      return 'walking';
    }
    return 'driving';
  }

  private calculateStraightLineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const earthRadiusInMeters = 6371000;
    const deltaLatitude = this.toRadians(lat2 - lat1);
    const deltaLongitude = this.toRadians(lon2 - lon1);

    const haversineValue =
      Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(deltaLongitude / 2) *
        Math.sin(deltaLongitude / 2);

    const centralAngle = 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue));
    return earthRadiusInMeters * centralAngle;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private orderPoisByLlmResponse(
    selectedPois: PoiItem[],
    orderedPoiIds: string[]
  ): PoiItem[] {
    const poiMap = new Map<string, PoiItem>();
    for (const poi of selectedPois) {
      poiMap.set(poi.id, poi);
    }

    const orderedPois: PoiItem[] = [];
    for (const poiId of orderedPoiIds) {
      const poi = poiMap.get(poiId);
      if (poi !== undefined) {
        orderedPois.push(poi);
      }
    }

    for (const poi of selectedPois) {
      if (!orderedPois.includes(poi)) {
        orderedPois.push(poi);
      }
    }

    return orderedPois;
  }

  private assignPoiIdsToSegments(
    segments: RouteSegment[],
    orderedPois: PoiItem[]
  ): RouteSegment[] {
    return segments.map((segment, index) => {
      const originPoi = orderedPois[index - 1] ?? null;
      const destinationPoi = orderedPois[index] ?? null;

      return {
        ...segment,
        originPoiId: originPoi?.id ?? '',
        destinationPoiId: destinationPoi?.id ?? '',
      };
    });
  }

  private parseDurationToMinutes(duration: string): number {
    const match = duration.match(/^(\d+(?:\.\d+)?)h$/);
    if (match !== null) {
      return Math.round(parseFloat(match[1]) * 60);
    }

    const minutesMatch = duration.match(/^(\d+)min$/);
    if (minutesMatch !== null) {
      return parseInt(minutesMatch[1], 10);
    }

    return 90;
  }
}

export const itineraryPlanningService = new ItineraryPlanningService();