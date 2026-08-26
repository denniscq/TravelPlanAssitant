import { AmapDirectionResponse, AmapWalkingDirectionResponse, AmapCyclingDirectionResponse, AmapTransitDirectionResponse } from '../types/amap-service-types';
import { RouteSegment, TransitLegDetail, WalkingLegDetail, TransportMode } from '../types/itinerary-types';
import { getAmapApiKey } from '../utils/environment';
import { ServerLogger } from '../utils/server-logger';

// Delay between consecutive API calls to avoid QPS limit (CUQPS_HAS_EXCEEDED_THE_LIMIT)
const API_CALL_DELAY_MS = 350;

// Minimum duration in seconds — never return 0 to avoid "0 min" display
const MIN_DURATION_SECONDS = 60;

// Maximum plausible city-route distance in meters. Any single Amap
// driving/walking/cycling segment longer than this is treated as a
// corrupted response (Amap has been observed returning distance values
// inflated by 700x on some requests — e.g. 18km routes reported as
// 12,683km). When this happens we fall back to a Haversine straight-line
// estimate × detour factor instead of trusting the bad value.
const MAX_PLAUSIBLE_DISTANCE_METERS = 500_000;

// Multiplier applied to straight-line distance when Amap returns a value
// above MAX_PLAUSIBLE_DISTANCE_METERS. 1.4 = typical urban detour factor.
const FALLBACK_DETOUR_FACTOR = 1.4;

export class AmapRouteCalculationService {
  private static readonly BASE_URL_V3 = 'https://restapi.amap.com/v3/direction';

  /**
   * Calculate route for each segment independently using the correct transport mode API.
   * Each segment gets its own API call, returning real polyline, distance, and duration.
   * A delay is added between calls to avoid exceeding the Amap QPS limit.
   */
  public async calculateRouteSegments(
    segmentRequests: {
      origin: { latitude: number; longitude: number };
      destination: { latitude: number; longitude: number };
      transportMode: TransportMode;
    }[],
    logger?: ServerLogger
  ): Promise<RouteSegment[]> {
    if (segmentRequests.length === 0) {
      logger?.info('No segment requests provided, returning empty array');
      return [];
    }

    logger?.info('========== ROUTE CALCULATION START ==========');
    logger?.info(`Total segments to calculate: ${segmentRequests.length}`);
    logger?.info(`API call delay between segments: ${API_CALL_DELAY_MS}ms`);
    logger?.info(`Segment list:`);
    segmentRequests.forEach((req, i) => {
      logger?.info(
        `  [${i}] ${req.transportMode}: ` +
        `(${req.origin.latitude.toFixed(6)},${req.origin.longitude.toFixed(6)}) -> ` +
        `(${req.destination.latitude.toFixed(6)},${req.destination.longitude.toFixed(6)})`
      );
    });

    const results: RouteSegment[] = [];

    for (let i = 0; i < segmentRequests.length; i++) {
      const { origin, destination, transportMode } = segmentRequests[i];
      const originStr = `${origin.longitude},${origin.latitude}`;
      const destStr = `${destination.longitude},${destination.latitude}`;

      logger?.info('');
      logger?.info(`---------- Segment ${i + 1}/${segmentRequests.length} ----------`);
      logger?.info(`  Mode: ${transportMode}`);
      logger?.info(`  Origin: lng=${origin.longitude.toFixed(6)}, lat=${origin.latitude.toFixed(6)}`);
      logger?.info(`  Destination: lng=${destination.longitude.toFixed(6)}, lat=${destination.latitude.toFixed(6)}`);
      logger?.info(`  Origin (API format): ${originStr}`);
      logger?.info(`  Destination (API format): ${destStr}`);

      // Add delay between API calls to avoid QPS limit
      if (i > 0) {
        logger?.info(`  Waiting ${API_CALL_DELAY_MS}ms (QPS limit protection)...`);
        await this.delay(API_CALL_DELAY_MS);
      }

      try {
        const routeResult = await this.fetchDirection(originStr, destStr, transportMode, logger);

        // Sanity guard: Amap sometimes returns a wildly inflated distance
        // (observed: 18km reported as 12,683km — likely a unit-conversion
        // bug on their side, or a malformed response). If the returned
        // distance is implausible for a single city segment, recompute
        // from straight-line and mark the segment so the operator can see
        // it in the log.
        let effectiveDistance = routeResult.distanceInMeters;
        if (effectiveDistance > MAX_PLAUSIBLE_DISTANCE_METERS) {
          const straightLine = this.calculateStraightLineDistance(
            origin.latitude, origin.longitude,
            destination.latitude, destination.longitude,
          );
          const fallbackDistance = Math.round(straightLine * FALLBACK_DETOUR_FACTOR);
          logger?.error(
            `  !!! Amap returned implausible distance ${effectiveDistance}m ` +
            `for ${transportMode} segment. ` +
            `Falling back to straight-line estimate ${fallbackDistance}m ` +
            `(straight=${Math.round(straightLine)}m × ${FALLBACK_DETOUR_FACTOR}).`,
          );
          effectiveDistance = fallbackDistance;
        }

        // Apply minimum duration floor — never return 0
        const safeDuration = Math.max(routeResult.durationInSeconds, MIN_DURATION_SECONDS);
        if (routeResult.durationInSeconds < MIN_DURATION_SECONDS && routeResult.durationInSeconds > 0) {
          logger?.warn(`  Duration ${routeResult.durationInSeconds}s is below minimum floor, clamping to ${MIN_DURATION_SECONDS}s`);
        }

        // For transit segments the inner fetcher returns extra structured details.
        const transitExtras = this.extractTransitExtras(routeResult);

        results.push({
          originIndex: i,
          destinationIndex: i + 1,
          originPoiId: '',
          destinationPoiId: '',
          distanceInMeters: effectiveDistance,
          durationInSeconds: safeDuration,
          transportMode,
          polylineCoordinates: routeResult.polylineCoordinates,
          ...(transitExtras ?? {}),
        });

        logger?.info(`  >>> Segment ${i + 1} SUCCESS:`);
        logger?.info(`      Distance: ${effectiveDistance}m (${(effectiveDistance / 1000).toFixed(2)}km)`);
        logger?.info(`      Duration: ${safeDuration}s (${Math.round(safeDuration / 60)}min)`);
        logger?.info(`      Polyline points: ${routeResult.polylineCoordinates.length}`);
        if (routeResult.polylineCoordinates.length > 0) {
          const first = routeResult.polylineCoordinates[0];
          const last = routeResult.polylineCoordinates[routeResult.polylineCoordinates.length - 1];
          logger?.info(`      Polyline first: (${first[1].toFixed(6)}, ${first[0].toFixed(6)})`);
          logger?.info(`      Polyline last: (${last[1].toFixed(6)}, ${last[0].toFixed(6)})`);
        }
        if (transitExtras?.transitLegs !== undefined && transitExtras.transitLegs.length > 0) {
          logger?.info(`      Transit legs: ${transitExtras.transitLegs.length}`);
          for (const leg of transitExtras.transitLegs) {
            logger?.info(`        - ${leg.transportType} ${leg.lineName}: ${leg.departureStopName} -> ${leg.arrivalStopName} (${leg.distanceMeters}m / ${leg.durationSeconds}s)`);
          }
        }
        if (transitExtras?.transitFee !== undefined) {
          logger?.info(`      Transit fee: ¥${transitExtras.transitFee}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger?.error(`  !!! Segment ${i + 1} FAILED: ${errorMsg}`);
        logger?.info(`  Using fallback estimation...`);

        // Fallback: compute straight-line estimate with Haversine distance
        const straightLineDist = this.calculateStraightLineDistance(
          origin.latitude, origin.longitude,
          destination.latitude, destination.longitude
        );
        // Estimate duration: driving ~10m/s, walking ~1.4m/s, cycling ~4m/s, transit ~8m/s
        const speedMps = transportMode === 'walking' ? 1.4
          : transportMode === 'cycling' ? 4
          : transportMode === 'transit' ? 8
          : 10;
        const estimatedDuration = Math.max(Math.round(straightLineDist / speedMps), MIN_DURATION_SECONDS);

        // Generate a 3-point polyline with perpendicular offset for visual curve
        const midLng = (origin.longitude + destination.longitude) / 2;
        const midLat = (origin.latitude + destination.latitude) / 2;
        const dLng = destination.longitude - origin.longitude;
        const dLat = destination.latitude - origin.latitude;
        const perpFactor = 0.0003;
        const offsetMidLng = midLng - dLat * perpFactor;
        const offsetMidLat = midLat + dLng * perpFactor;

        results.push({
          originIndex: i,
          destinationIndex: i + 1,
          originPoiId: '',
          destinationPoiId: '',
          distanceInMeters: Math.round(straightLineDist),
          durationInSeconds: estimatedDuration,
          transportMode,
          polylineCoordinates: [
            [origin.longitude, origin.latitude],
            [offsetMidLng, offsetMidLat],
            [destination.longitude, destination.latitude],
          ],
        });

        logger?.info(`  >>> Segment ${i + 1} FALLBACK RESULT:`);
        logger?.info(`      Straight-line distance: ${Math.round(straightLineDist)}m (${(straightLineDist / 1000).toFixed(2)}km)`);
        logger?.info(`      Estimated duration: ${estimatedDuration}s (${Math.round(estimatedDuration / 60)}min)`);
        logger?.info(`      Polyline: 3 points (straight-line with curve offset)`);
      }
    }

    logger?.info('');
    logger?.info('========== ROUTE CALCULATION COMPLETE ==========');
    const totalDistance = results.reduce((sum, r) => sum + r.distanceInMeters, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.durationInSeconds, 0);
    const totalPolylinePoints = results.reduce((sum, r) => sum + r.polylineCoordinates.length, 0);
    logger?.info(`  Segments calculated: ${results.length}`);
    logger?.info(`  Total distance: ${totalDistance}m (${(totalDistance / 1000).toFixed(2)}km)`);
    logger?.info(`  Total duration: ${totalDuration}s (${Math.round(totalDuration / 60)}min)`);
    logger?.info(`  Total polyline points: ${totalPolylinePoints}`);
    logger?.info('');

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchDirection(
    origin: string,
    destination: string,
    mode: TransportMode,
    logger?: ServerLogger
  ): Promise<{
    distanceInMeters: number;
    durationInSeconds: number;
    polylineCoordinates: [number, number][];
  }> {
    switch (mode) {
      case 'driving':
        return this.fetchDrivingDirection(origin, destination, logger);
      case 'walking':
        return this.fetchWalkingDirection(origin, destination, logger);
      case 'cycling':
        return this.fetchCyclingDirection(origin, destination, logger);
      case 'transit':
        return this.fetchTransitDirection(origin, destination, logger);
      case 'taxi':
        // AMap has no dedicated ride-hailing API — reuse driving directions.
        return this.fetchDrivingDirection(origin, destination, logger);
      default:
        return this.fetchDrivingDirection(origin, destination, logger);
    }
  }

  /**
   * Driving direction using V3 API.
   * IMPORTANT: extensions=all is REQUIRED — extensions=base returns NO steps/polyline data,
   * which was the root cause of straight-line routes and 0 duration values.
   */
  private async fetchDrivingDirection(
    origin: string,
    destination: string,
    logger?: ServerLogger
  ): Promise<{
    distanceInMeters: number;
    durationInSeconds: number;
    polylineCoordinates: [number, number][];
  }> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      origin,
      destination,
      strategy: '0', // 0 = speed priority
      extensions: 'all', // MUST be 'all' to get steps with polyline data
    });

    const url = `${AmapRouteCalculationService.BASE_URL_V3}/driving?${params.toString()}`;

    logger?.info(`  [Driving] Request URL: ${url}`);

    const response = await fetch(url);
    logger?.info(`  [Driving] HTTP status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`Driving API HTTP ${response.status} ${response.statusText}`);
    }

    let data: AmapDirectionResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('Driving API returned non-JSON response');
    }

    // Log the full API response for debugging
    // Log the RAW API response body for maximum debuggability
    logger?.info(`  [Driving] RAW API response (first 2000 chars): ${JSON.stringify(data).substring(0, 2000)}`);

    logger?.info(`  [Driving] API response status: ${data.status}`);
    logger?.info(`  [Driving] API response info: ${data.info}`);
    logger?.info(`  [Driving] Route origin: ${data.route?.origin ?? 'N/A'}`);
    logger?.info(`  [Driving] Route destination: ${data.route?.destination ?? 'N/A'}`);
    logger?.info(`  [Driving] Paths count: ${data.route?.paths?.length ?? 0}`);

    if (data.status !== '1') {
      logger?.error(`  [Driving] API returned error status: ${data.info}`);
      throw new Error(`Driving API failed: ${data.info}`);
    }

    const path = data.route?.paths?.[0];
    if (path === undefined || path === null) {
      throw new Error('Driving API returned no paths in response');
    }

    logger?.info(`  [Driving] Path[0] distance: ${path.distance}m`);
    logger?.info(`  [Driving] Path[0] duration: ${path.duration}s`);
    logger?.info(`  [Driving] Path[0] steps count: ${path.steps?.length ?? 0}`);

    // Log each step's road and polyline length for debugging
    if (path.steps && path.steps.length > 0) {
      path.steps.forEach((step, idx) => {
        const polylinePointCount = step.polyline ? step.polyline.split(';').length : 0;
        logger?.info(`    Step[${idx}]: road=${step.road || 'N/A'}, distance=${step.distance}m, polyline_points=${polylinePointCount}`);
      });
    }

    const distance = parseInt(path.distance, 10);
    const duration = parseInt(path.duration, 10);
    const polylineCoords = this.parsePolyline(path.steps);

    logger?.info(`  [Driving] Parsed result:`);
    logger?.info(`    distance=${distance}m, duration=${duration}s, polyline_points=${polylineCoords.length}`);

    return {
      distanceInMeters: isNaN(distance) ? 0 : distance,
      durationInSeconds: isNaN(duration) ? 0 : duration,
      polylineCoordinates: polylineCoords,
    };
  }

  private async fetchWalkingDirection(
    origin: string,
    destination: string,
    logger?: ServerLogger
  ): Promise<{
    distanceInMeters: number;
    durationInSeconds: number;
    polylineCoordinates: [number, number][];
  }> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      origin,
      destination,
    });

    const url = `${AmapRouteCalculationService.BASE_URL_V3}/walking?${params.toString()}`;

    logger?.info(`  [Walking] Request URL: ${url}`);

    const response = await fetch(url);
    logger?.info(`  [Walking] HTTP status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`Walking API HTTP ${response.status} ${response.statusText}`);
    }

    let data: AmapWalkingDirectionResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('Walking API returned non-JSON response');
    }

    // Log the RAW API response body for maximum debuggability
    logger?.info(`  [Walking] RAW API response (first 2000 chars): ${JSON.stringify(data).substring(0, 2000)}`);

    logger?.info(`  [Walking] API response status: ${data.status}`);
    logger?.info(`  [Walking] API response info: ${data.info}`);
    logger?.info(`  [Walking] Paths count: ${data.route?.paths?.length ?? 0}`);

    if (data.status !== '1') {
      logger?.error(`  [Walking] API returned error status: ${data.info}`);
      throw new Error(`Walking API failed: ${data.info}`);
    }

    const path = data.route?.paths?.[0];
    if (path === undefined || path === null) {
      throw new Error('Walking API returned no paths in response');
    }

    logger?.info(`  [Walking] Path[0] distance: ${path.distance}m`);
    logger?.info(`  [Walking] Path[0] duration: ${path.duration}s`);
    logger?.info(`  [Walking] Path[0] steps count: ${path.steps?.length ?? 0}`);

    if (path.steps && path.steps.length > 0) {
      path.steps.forEach((step, idx) => {
        const polylinePointCount = step.polyline ? step.polyline.split(';').length : 0;
        logger?.info(`    Step[${idx}]: road=${step.road || 'N/A'}, distance=${step.distance}m, polyline_points=${polylinePointCount}`);
      });
    }

    const distance = parseInt(path.distance, 10);
    const duration = parseInt(path.duration, 10);
    const polylineCoords = this.parsePolyline(path.steps);

    logger?.info(`  [Walking] Parsed result: distance=${distance}m, duration=${duration}s, polyline_points=${polylineCoords.length}`);

    return {
      distanceInMeters: isNaN(distance) ? 0 : distance,
      durationInSeconds: isNaN(duration) ? 0 : duration,
      polylineCoordinates: polylineCoords,
    };
  }

  private async fetchCyclingDirection(
    origin: string,
    destination: string,
    logger?: ServerLogger
  ): Promise<{
    distanceInMeters: number;
    durationInSeconds: number;
    polylineCoordinates: [number, number][];
  }> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      origin,
      destination,
    });

    const url = `${AmapRouteCalculationService.BASE_URL_V3}/bicycling?${params.toString()}`;

    logger?.info(`  [Cycling] Request URL: ${url}`);

    const response = await fetch(url);
    logger?.info(`  [Cycling] HTTP status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`Cycling API HTTP ${response.status} ${response.statusText}`);
    }

    let data: AmapCyclingDirectionResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('Cycling API returned non-JSON response');
    }

    // Log the RAW API response body for maximum debuggability
    logger?.info(`  [Cycling] RAW API response (first 2000 chars): ${JSON.stringify(data).substring(0, 2000)}`);

    logger?.info(`  [Cycling] API response status: ${data.status}`);
    logger?.info(`  [Cycling] API response info: ${data.info}`);
    logger?.info(`  [Cycling] Paths count: ${data.route?.paths?.length ?? 0}`);

    if (data.status !== '1') {
      logger?.error(`  [Cycling] API returned error status: ${data.info}`);
      throw new Error(`Cycling API failed: ${data.info}`);
    }

    const path = data.route?.paths?.[0];
    if (path === undefined || path === null) {
      throw new Error('Cycling API returned no paths in response');
    }

    logger?.info(`  [Cycling] Path[0] distance: ${path.distance}m`);
    logger?.info(`  [Cycling] Path[0] duration: ${path.duration}s`);
    logger?.info(`  [Cycling] Path[0] steps count: ${path.steps?.length ?? 0}`);

    if (path.steps && path.steps.length > 0) {
      path.steps.forEach((step, idx) => {
        const polylinePointCount = step.polyline ? step.polyline.split(';').length : 0;
        logger?.info(`    Step[${idx}]: road=${step.road || 'N/A'}, distance=${step.distance}m, polyline_points=${polylinePointCount}`);
      });
    }

    const distance = parseInt(path.distance, 10);
    const duration = parseInt(path.duration, 10);
    const polylineCoords = this.parsePolyline(path.steps);

    logger?.info(`  [Cycling] Parsed result: distance=${distance}m, duration=${duration}s, polyline_points=${polylineCoords.length}`);

    return {
      distanceInMeters: isNaN(distance) ? 0 : distance,
      durationInSeconds: isNaN(duration) ? 0 : duration,
      polylineCoordinates: polylineCoords,
    };
  }

  /**
   * Transit direction using V3 integrated transit API.
   * Parses polyline from transit segments, each segment has walking and riding sub-steps.
   * Also extracts structured transit-leg details (line name, boarding/alighting stop names,
   * first/last train times, transit fee) so the LLM can quote real values in the
   * rendered markdown plan instead of inventing them.
   */
  private async fetchTransitDirection(
    origin: string,
    destination: string,
    logger?: ServerLogger
  ): Promise<{
    distanceInMeters: number;
    durationInSeconds: number;
    polylineCoordinates: [number, number][];
    transitLegs: TransitLegDetail[];
    transitFee: number | undefined;
    walkingLegs: WalkingLegDetail[];
  }> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      origin,
      destination,
      city: '全国',
      strategy: '0', // 0 = fastest transit
      extensions: 'all', // Request full segment data including polylines
    });

    const url = `${AmapRouteCalculationService.BASE_URL_V3}/transit/integrated?${params.toString()}`;

    logger?.info(`  [Transit] Request URL: ${url}`);

    const response = await fetch(url);
    logger?.info(`  [Transit] HTTP status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`Transit API HTTP ${response.status} ${response.statusText}`);
    }

    let data: AmapTransitDirectionResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('Transit API returned non-JSON response');
    }

    // Log the RAW API response body for maximum debuggability
    logger?.info(`  [Transit] RAW API response (first 2000 chars): ${JSON.stringify(data).substring(0, 2000)}`);

    logger?.info(`  [Transit] API response status: ${data.status}`);
    logger?.info(`  [Transit] API response info: ${data.info}`);

    if (data.status !== '1') {
      logger?.error(`  [Transit] API returned error status: ${data.info}`);
      throw new Error(`Transit API failed: ${data.info}`);
    }

    // IMPORTANT: real key is `transits` (array), not `transit`. Pick the fastest
    // itinerary (lowest duration) since the user wants the optimal route.
    const transits = data.route?.transits;
    if (transits === undefined || transits === null || transits.length === 0) {
      logger?.error('  [Transit] No `transits` array in response (raw route keys: ' +
        (data.route ? Object.keys(data.route).join(',') : 'route missing') + ')');
      throw new Error('Transit route not found in response');
    }

    const chosen = transits.slice().sort((a, b) => {
      return parseInt(a.duration, 10) - parseInt(b.duration, 10);
    })[0];

    logger?.info(`  [Transit] itineraries=${transits.length}, chose duration=${chosen.duration}s (distance=${chosen.distance}m)`);
    logger?.info(`  [Transit] Chosen itinerary has ${chosen.segments?.length ?? 0} segments`);

    // Parse polyline from chosen itinerary segments.
    let polylineCoords = this.parseTransitPolyline(chosen.segments, logger);

    const distance = parseInt(chosen.distance, 10);
    const duration = parseInt(chosen.duration, 10);

    // If polyline is still empty after parsing (rare, but possible when no
    // walking/bus polyline is returned), fetch walking direction as a final
    // fallback so we always render a real shape.
    if (polylineCoords.length < 2) {
      logger?.warn('  [Transit] No polyline after parsing — falling back to walking polyline for path shape');
      try {
        const walkingPolyline = await this.fetchWalkingPolylineOnly(origin, destination, logger);
        if (walkingPolyline.length >= 2) {
          polylineCoords = walkingPolyline;
        }
      } catch (fallbackError) {
        const fbMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger?.warn(`  [Transit] Walking-polyline fallback failed - ${fbMessage}`);
      }
    }

    logger?.info(`  [Transit] Parsed result: distance=${distance}m, duration=${duration}s, polyline_points=${polylineCoords.length}`);

    // Extract structured transit-leg details and total fee from the chosen itinerary.
    const { transitLegs, transitFee, walkingLegs } = this.parseTransitLegDetails(chosen, logger);

    return {
      distanceInMeters: isNaN(distance) ? 0 : distance,
      durationInSeconds: isNaN(duration) ? 0 : duration,
      polylineCoordinates: polylineCoords,
      transitLegs,
      transitFee,
      walkingLegs,
    };
  }

  /**
   * Fetch only the polyline from the walking direction API. Used as a shape
   * fallback for transit segments whose integrated response lacks polyline
   * data. The walking API reliably returns polyline (its `extensions=base`
   * default works), giving us real road geometry instead of a straight line.
   */
  private async fetchWalkingPolylineOnly(
    origin: string,
    destination: string,
    logger?: ServerLogger
  ): Promise<[number, number][]> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      origin,
      destination,
    });

    const url = `${AmapRouteCalculationService.BASE_URL_V3}/walking?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Walking fallback HTTP ${response.status}`);
    }

    const data = (await response.json()) as AmapWalkingDirectionResponse;
    if (data.status !== '1') {
      throw new Error(`Walking fallback API error - ${data.info}`);
    }

    const path = data.route?.paths?.[0];
    if (path === undefined || path === null) {
      throw new Error('Walking fallback returned no paths');
    }

    const coords = this.parsePolyline(path.steps);
    logger?.info(`  [Transit] Walking-polyline fallback yielded ${coords.length} points`);
    return coords;
  }

  /**
   * Extract optional transit-specific extras (legs, fee, walking legs) from a
   * generic direction-fetcher result. Returns null for non-transit modes or
   * when the inner fetcher didn't populate any extras.
   */
  private extractTransitExtras(
    routeResult: unknown
  ): { transitLegs: TransitLegDetail[]; transitFee: number | undefined; walkingLegs: WalkingLegDetail[] } | null {
    if (
      typeof routeResult !== 'object' ||
      routeResult === null ||
      !('transitLegs' in routeResult)
    ) {
      return null;
    }
    const candidate = routeResult as {
      transitLegs?: TransitLegDetail[];
      transitFee?: number;
      walkingLegs?: WalkingLegDetail[];
    };
    return {
      transitLegs: candidate.transitLegs ?? [],
      transitFee: candidate.transitFee,
      walkingLegs: candidate.walkingLegs ?? [],
    };
  }

  /**
   * Parse structured transit-leg details from a chosen transit itinerary.
   *
   * Real AMap shape (per transit/integrated response, `extensions=all`):
   *   segments[i].bus.buslines[j]      — bus legs, one entry per busline
   *   segments[i].subway.buslines[j]   — subway legs, same shape
   *   segments[i].walking.steps[]      — walking legs (origin to first stop,
   *                                       transfer between bus lines, last stop to destination)
   *   segments[i].railway.trips[]      — railway legs (e.g. long-distance bus)
   *
   * The Amap `type` field uses "地铁线路" / "公交线路" / "火车线路" labels;
   * we map these to our transportType enum.
   */
  private parseTransitLegDetails(
    itinerary: unknown,
    logger?: ServerLogger
  ): { transitLegs: TransitLegDetail[]; transitFee: number | undefined; walkingLegs: WalkingLegDetail[] } {
    const transitLegs: TransitLegDetail[] = [];
    const walkingLegs: WalkingLegDetail[] = [];
    let transitFee: number | undefined;

    if (itinerary === null || typeof itinerary !== 'object') {
      return { transitLegs, transitFee, walkingLegs };
    }
    const it = itinerary as Record<string, unknown>;

    // Extract total transit fee from itinerary.cost (string, in yuan)
    const costStr = it.cost;
    if (typeof costStr === 'string' && costStr.length > 0) {
      const parsed = parseFloat(costStr);
      if (!isNaN(parsed) && parsed >= 0) {
        transitFee = parsed;
      }
    }

    const segments = it.segments;
    if (!Array.isArray(segments)) {
      logger?.warn('  [Transit] parseTransitLegDetails: itinerary.segments is not an array');
      return { transitLegs, transitFee, walkingLegs };
    }

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx] as Record<string, unknown>;

      // Bus legs
      const bus = seg.bus as { buslines?: unknown[] } | undefined;
      if (bus?.buslines !== undefined && Array.isArray(bus.buslines)) {
        for (const raw of bus.buslines) {
          const leg = this.parseBusline(raw, logger);
          if (leg !== null) transitLegs.push(leg);
        }
      }

      // Subway legs (same shape as bus)
      const subway = seg.subway as { buslines?: unknown } | undefined;
      if (subway?.buslines !== undefined && Array.isArray(subway.buslines)) {
        for (const raw of subway.buslines) {
          const leg = this.parseBusline(raw, logger);
          if (leg !== null) transitLegs.push(leg);
        }
      }

      // Railway legs (long-distance bus / train)
      const railway = seg.railway as { trips?: unknown } | undefined;
      if (railway?.trips !== undefined && Array.isArray(railway.trips)) {
        for (const raw of railway.trips) {
          const leg = this.parseRailwayTrip(raw, logger);
          if (leg !== null) transitLegs.push(leg);
        }
      }

      // Walking leg (capture at most 2 — the first origin-walk and the last destination-walk)
      const walking = seg.walking as
        | { distance?: string; duration?: string; steps?: { instruction?: string }[] }
        | undefined;
      if (walking !== undefined && walking.steps !== undefined && Array.isArray(walking.steps)) {
        const distanceMeters = parseInt(walking.distance ?? '0', 10);
        const durationSeconds = parseInt(walking.duration ?? '0', 10);
        const instructionParts: string[] = [];
        for (const step of walking.steps) {
          if (typeof step.instruction === 'string' && step.instruction.length > 0) {
            instructionParts.push(step.instruction);
          }
        }
        walkingLegs.push({
          distanceMeters: isNaN(distanceMeters) ? 0 : distanceMeters,
          durationSeconds: isNaN(durationSeconds) ? 0 : durationSeconds,
          instruction: instructionParts.join('; '),
        });
      }
    }

    logger?.info(
      `  [Transit] parseTransitLegDetails: legs=${transitLegs.length}, ` +
      `walkingLegs=${walkingLegs.length}, fee=${transitFee ?? 'N/A'}`
    );

    return { transitLegs, transitFee, walkingLegs };
  }

  /**
   * Parse a single busline / subway-line entry into a TransitLegDetail.
   * Returns null if the entry lacks the minimum required fields.
   */
  private parseBusline(raw: unknown, logger?: ServerLogger): TransitLegDetail | null {
    if (raw === null || typeof raw !== 'object') return null;
    const line = raw as Record<string, unknown>;
    const departureStop = line.departure_stop as { name?: string } | undefined;
    const arrivalStop = line.arrival_stop as { name?: string } | undefined;
    const lineName = typeof line.name === 'string' ? line.name : '';
    const departureStopName = departureStop?.name ?? '';
    const arrivalStopName = arrivalStop?.name ?? '';
    if (lineName.length === 0 || departureStopName.length === 0 || arrivalStopName.length === 0) {
      logger?.warn(`  [Transit] parseBusline: missing required fields (name/departure_stop.name/arrival_stop.name) — skipping`);
      return null;
    }
    const typeStr = typeof line.type === 'string' ? line.type : '';
    const transportType: TransitLegDetail['transportType'] =
      typeStr.includes('地铁') ? 'subway'
      : typeStr.includes('火车') || typeStr.includes('铁路') ? 'railway'
      : 'bus';
    const viaStopCount = parseInt((line.via_num as string | undefined) ?? '0', 10);
    const distanceMeters = parseInt((line.distance as string | undefined) ?? '0', 10);
    const durationSeconds = parseInt((line.duration as string | undefined) ?? '0', 10);
    return {
      transportType,
      lineName,
      departureStopName,
      arrivalStopName,
      viaStopCount: isNaN(viaStopCount) ? 0 : viaStopCount,
      startTime: typeof line.start_time === 'string' ? line.start_time : '',
      endTime: typeof line.end_time === 'string' ? line.end_time : '',
      distanceMeters: isNaN(distanceMeters) ? 0 : distanceMeters,
      durationSeconds: isNaN(durationSeconds) ? 0 : durationSeconds,
    };
  }

  /**
   * Parse a railway trip entry (e.g. intercity bus, train) into a TransitLegDetail.
   * Railway trips may not have explicit departure_stop/arrival_stop.name — fall back
   * to the trip's own `name` field when missing.
   */
  private parseRailwayTrip(raw: unknown, logger?: ServerLogger): TransitLegDetail | null {
    if (raw === null || typeof raw !== 'object') return null;
    const trip = raw as Record<string, unknown>;
    const departureStop = trip.departure_stop as { name?: string } | undefined;
    const arrivalStop = trip.arrival_stop as { name?: string } | undefined;
    const lineName = typeof trip.name === 'string' ? trip.name : '';
    const departureStopName = departureStop?.name ?? '';
    const arrivalStopName = arrivalStop?.name ?? '';
    if (lineName.length === 0) {
      logger?.warn(`  [Transit] parseRailwayTrip: missing required field 'name' — skipping`);
      return null;
    }
    const distanceMeters = parseInt((trip.distance as string | undefined) ?? '0', 10);
    const durationSeconds = parseInt((trip.time as string | undefined) ?? '0', 10);
    return {
      transportType: 'railway',
      lineName,
      departureStopName,
      arrivalStopName,
      viaStopCount: 0,
      startTime: '',
      endTime: '',
      distanceMeters: isNaN(distanceMeters) ? 0 : distanceMeters,
      durationSeconds: isNaN(durationSeconds) ? 0 : durationSeconds,
    };
  }

/**
 * Parse polyline coordinates from transit itinerary segments.
 *
 * Real AMap shape (per transit/integrated response, `extensions=all`):
 *   segments[i].walking.steps[].polyline      — walking legs (each step has a polyline string)
 *   segments[i].bus.buslines[].polyline       — bus legs (one polyline per busline)
 *   segments[i].subway.steps[].polyline       — subway legs (same shape as walking)
 *   segments[i].railway.trips[].polyline      — railway legs (when applicable)
 *
 * Each polyline string is "lng,lat;lng,lat;...". We concatenate them all in
 * trip order to produce a single coordinate list for the renderer.
 */
  private parseTransitPolyline(
    segments: unknown[] | undefined,
    logger?: ServerLogger
  ): [number, number][] {
    const coordinates: [number, number][] = [];

    if (segments === undefined || segments === null || !Array.isArray(segments)) {
      logger?.warn('  [Transit] No segments array found in response');
      return coordinates;
    }

    let walkingStepsParsed = 0;
    let buslinesParsed = 0;
    let subwayStepsParsed = 0;

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx] as Record<string, unknown>;

      // --- Walking leg ---
      const walking = seg.walking as { steps?: { polyline?: string }[] } | undefined;
      if (walking?.steps && Array.isArray(walking.steps)) {
        for (const step of walking.steps) {
          const stepCoords = this.parseSinglePolyline(step.polyline);
          if (stepCoords.length > 0) walkingStepsParsed++;
          coordinates.push(...stepCoords);
        }
      }

      // --- Bus leg ---
      const bus = seg.bus as { buslines?: { polyline?: string }[] } | undefined;
      if (bus?.buslines && Array.isArray(bus.buslines)) {
        for (const line of bus.buslines) {
          const lineCoords = this.parseSinglePolyline(line.polyline);
          if (lineCoords.length > 0) buslinesParsed++;
          coordinates.push(...lineCoords);
        }
      }

      // --- Subway leg ---
      const subway = seg.subway as { steps?: { polyline?: string }[] } | undefined;
      if (subway?.steps && Array.isArray(subway.steps)) {
        for (const step of subway.steps) {
          const stepCoords = this.parseSinglePolyline(step.polyline);
          if (stepCoords.length > 0) subwayStepsParsed++;
          coordinates.push(...stepCoords);
        }
      }

      // --- Railway leg (some cities have rail in transit result) ---
      const railway = seg.railway as { trips?: { polyline?: string }[] } | undefined;
      if (railway?.trips && Array.isArray(railway.trips)) {
        for (const trip of railway.trips) {
          const tripCoords = this.parseSinglePolyline(trip.polyline);
          coordinates.push(...tripCoords);
        }
      }
    }

    logger?.info(
      `  [Transit] Polyline parse: walkingSteps=${walkingStepsParsed}, ` +
      `buslines=${buslinesParsed}, subwaySteps=${subwayStepsParsed}, total points=${coordinates.length}`
    );

    if (coordinates.length === 0) {
      logger?.warn('  [Transit] No polyline coordinates parsed from any segment');
    }

    return coordinates;
  }

  /**
   * Parse a single polyline string (format: "lng,lat;lng,lat;...")
   */
  private parseSinglePolyline(polyline: string | undefined): [number, number][] {
    const coordinates: [number, number][] = [];

    if (polyline === undefined || polyline === null || polyline.length === 0) {
      return coordinates;
    }

    const polylineSegments = polyline.split(';');
    for (const segment of polylineSegments) {
      const parts = segment.split(',');
      if (parts.length >= 2) {
        const longitude = Number(parts[0]);
        const latitude = Number(parts[1]);
        if (!isNaN(longitude) && !isNaN(latitude)) {
          coordinates.push([longitude, latitude]);
        }
      }
    }

    return coordinates;
  }

  private parsePolyline(steps: { polyline?: string }[] | undefined): [number, number][] {
    if (steps === undefined || steps === null) {
      return [];
    }

    const coordinates: [number, number][] = [];
    for (const step of steps) {
      const stepCoords = this.parseSinglePolyline(step.polyline);
      coordinates.push(...stepCoords);
    }

    return coordinates;
  }

  /** Haversine straight-line distance between two geographic points in meters */
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
}

export const amapRouteCalculationService = new AmapRouteCalculationService();
