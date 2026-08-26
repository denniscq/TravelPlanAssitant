import { PoiItem } from '../types/poi-types';
import {
  ItineraryPlan,
  ItineraryStop,
  LlmRoutePlanRequest,
  LlmRoutePlanError,
  RouteSegment,
  TransportMode,
  CostBreakdown,
} from '../types/itinerary-types';
import { llmService } from './LLMService';
import { amapRouteCalculationService } from './AmapRouteCalculationService';
import { transportModeSelector } from './TransportModeSelector';
import { buildItineraryMarkdown } from '../utils/itinerary-markdown-builder';
import { ServerLogger } from '../utils/server-logger';

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
        { latitude: startLatitude, longitude: startLongitude, name: startLocation },
        ...orderedPois.map((poi) => ({ latitude: poi.latitude, longitude: poi.longitude, name: poi.name })),
        { latitude: endLatitude, longitude: endLongitude, name: endLocation },
      ];

      logger?.info(`Route points (${routePoints.length}):`);
      routePoints.forEach((rp, i) => {
        logger?.info(`  Point[${i}]: lat=${rp.latitude.toFixed(6)}, lng=${rp.longitude.toFixed(6)}, name=${rp.name}`);
      });

      // Decide transport mode per segment via TransportModeSelector
      // (LLM's transportMode field is intentionally ignored — see SYSTEM_PROMPT).
      const selectorInputs = routePoints.slice(0, -1).map((origin, i) => ({
        origin,
        destination: routePoints[i + 1],
      }));
      const decisions = await transportModeSelector.decideForSegments(selectorInputs, logger);

      // Build per-segment route requests using the decided modes.
      const segmentRequests = decisions.map((decision, i) => ({
        origin: selectorInputs[i].origin,
        destination: selectorInputs[i].destination,
        transportMode: decision.mode,
      }));

      logger?.info(`Segment requests (${segmentRequests.length}):`);
      segmentRequests.forEach((sr, i) => {
        logger?.info(
          `  Segment[${i}]: mode=${sr.transportMode}, ` +
          `origin=(${sr.origin.latitude.toFixed(6)},${sr.origin.longitude.toFixed(6)}), ` +
          `dest=(${sr.destination.latitude.toFixed(6)},${sr.destination.longitude.toFixed(6)})`
        );
      });

      logger?.info('--- Step 5: Calculating route segments via Amap API ---');
      const segments = await amapRouteCalculationService.calculateRouteSegments(segmentRequests, logger);

      logger?.info('--- Step 6: Assigning POI IDs to segments + applying rental notes ---');
      const segmentsWithPoiIds = this.assignPoiIdsToSegments(segments, orderedPois);

      // Annotate stops with the decided mode + 'rental' notes where applicable.
      // Segment[i] travels from routePoints[i] to routePoints[i+1]; its mode
      // is the mode for reaching the destination stop i (0-based).
      this.applyDecidedModesToStops(stops, decisions);

      const totalDistance = segmentsWithPoiIds.reduce(
        (sum, segment) => sum + segment.distanceInMeters,
        0
      );
      const totalDuration = segmentsWithPoiIds.reduce(
        (sum, segment) => sum + segment.durationInSeconds,
        0
      );

      logger?.info('--- Step 7: Recomputing transportation cost from real segments ---');
      const realTransportationCost = this.computeTransportationCost(segmentsWithPoiIds);
      logger?.info(`  Real transportation cost: ¥${realTransportationCost} (transit fee + driving/taxi estimate)`);

      // Rebuild costBreakdown with the real transportation figure. Keep LLM's
      // tickets/meals estimates (those are about POIs, not routes).
      const realCostBreakdown: CostBreakdown = {
        tickets: llmResponse.costBreakdown.tickets,
        meals: llmResponse.costBreakdown.meals,
        transportation: realTransportationCost,
        total: llmResponse.costBreakdown.tickets + llmResponse.costBreakdown.meals + realTransportationCost,
      };

      logger?.info('--- Step 8: Building markdownPlan from real route data (template) ---');
      // Build the markdownPlan deterministically from the SAME `stops` and
      // `segments` arrays that SimplifiedMap uses to draw the diagram. This
      // guarantees the text refers to the same endpoints, distances,
      // durations and transport modes as the map — they cannot drift out of
      // sync, regardless of what the LLM returns. The LLM still contributes
      // stop-local notes ("what to see/eat"), but those don't depend on
      // ordering and so can't introduce an image/text mismatch.
      const finalMarkdownPlan: string = buildItineraryMarkdown({
        startLocation,
        endLocation,
        stops,
        segments: segmentsWithPoiIds,
        costBreakdown: realCostBreakdown,
        totalDistanceInMeters: totalDistance,
        totalDurationInSeconds: totalDuration,
      });

      logger?.info('========== ITINERARY PLANNING COMPLETE ==========');
      logger?.info(`  Stops: ${stops.length}`);
      logger?.info(`  Segments: ${segmentsWithPoiIds.length}`);
      logger?.info(`  Total distance: ${totalDistance}m (${(totalDistance / 1000).toFixed(2)}km)`);
      logger?.info(`  Total duration: ${totalDuration}s (${Math.round(totalDuration / 60)}min)`);
      logger?.info(`  Markdown plan length: ${finalMarkdownPlan.length} chars`);
      logger?.info(`  Cost breakdown: tickets=${realCostBreakdown.tickets}, meals=${realCostBreakdown.meals}, transport=${realCostBreakdown.transportation}, total=${realCostBreakdown.total}`);
      logger?.info('');

      return {
        stops,
        segments: segmentsWithPoiIds,
        totalDistanceInMeters: totalDistance,
        totalDurationInSeconds: totalDuration,
        startLocation,
        endLocation,
        markdownPlan: finalMarkdownPlan,
        costBreakdown: realCostBreakdown,
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
   * Apply the transport-mode decisions to the ItineraryStop objects.
   *
   * Decisions are indexed by segment. Segment[i] travels from routePoints[i]
   * to routePoints[i+1], so its decided mode applies to reaching stop i
   * (0-based). For segments beyond the last stop (POI -> end), the mode
   * applies to the last stop.
   *
   * Also appends a '建议租车/包车' suffix to the stop notes when the
   * corresponding segment is flagged suggestRental.
   */
  private applyDecidedModesToStops(
    stops: ItineraryStop[],
    decisions: { mode: TransportMode; suggestRental: boolean }[]
  ): void {
    for (let i = 0; i < stops.length; i++) {
      const decision = decisions[i] ?? decisions[decisions.length - 1];
      if (decision === undefined) continue;

      stops[i].transportMode = decision.mode;

      if (decision.suggestRental) {
        const suffix = '（距离较远，建议租车/包车）';
        const existing = stops[i].notes ?? '';
        stops[i].notes = existing.length > 0 ? `${existing} ${suffix}` : suffix;
      }
    }
  }

  /**
   * Compute total transportation cost in yuan from real Amap segments.
   * - transit segments: use the real transitFee returned by Amap (e.g. ¥3).
   * - driving / taxi segments: estimate ¥0.6 per km (fuel cost only — no meter).
   * - walking / cycling segments: ¥0.
   */
  private computeTransportationCost(segments: RouteSegment[]): number {
    let total = 0;
    for (const seg of segments) {
      if (seg.transportMode === 'transit') {
        if (seg.transitFee !== undefined && seg.transitFee > 0) {
          total += seg.transitFee;
        }
      } else if (seg.transportMode === 'driving' || seg.transportMode === 'taxi') {
        total += Math.round((seg.distanceInMeters / 1000) * 0.6);
      }
      // walking / cycling => no cost
    }
    return total;
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