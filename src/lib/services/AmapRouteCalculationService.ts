import { AmapDirectionResponse, AmapWalkingDirectionResponse, AmapCyclingDirectionResponse, AmapTransitDirectionResponse } from '../types/amap-service-types';
import { RouteSegment, TransportMode } from '../types/itinerary-types';
import { getAmapApiKey } from '../utils/environment';
import { ServerLogger } from '../utils/server-logger';

// Delay between consecutive API calls to avoid QPS limit (CUQPS_HAS_EXCEEDED_THE_LIMIT)
const API_CALL_DELAY_MS = 350;

// Minimum duration in seconds — never return 0 to avoid "0 min" display
const MIN_DURATION_SECONDS = 60;

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

        // Apply minimum duration floor — never return 0
        const safeDuration = Math.max(routeResult.durationInSeconds, MIN_DURATION_SECONDS);
        if (routeResult.durationInSeconds < MIN_DURATION_SECONDS && routeResult.durationInSeconds > 0) {
          logger?.warn(`  Duration ${routeResult.durationInSeconds}s is below minimum floor, clamping to ${MIN_DURATION_SECONDS}s`);
        }

        results.push({
          originIndex: i,
          destinationIndex: i + 1,
          originPoiId: '',
          destinationPoiId: '',
          distanceInMeters: routeResult.distanceInMeters,
          durationInSeconds: safeDuration,
          transportMode,
          polylineCoordinates: routeResult.polylineCoordinates,
        });

        logger?.info(`  >>> Segment ${i + 1} SUCCESS:`);
        logger?.info(`      Distance: ${routeResult.distanceInMeters}m (${(routeResult.distanceInMeters / 1000).toFixed(2)}km)`);
        logger?.info(`      Duration: ${safeDuration}s (${Math.round(safeDuration / 60)}min)`);
        logger?.info(`      Polyline points: ${routeResult.polylineCoordinates.length}`);
        if (routeResult.polylineCoordinates.length > 0) {
          const first = routeResult.polylineCoordinates[0];
          const last = routeResult.polylineCoordinates[routeResult.polylineCoordinates.length - 1];
          logger?.info(`      Polyline first: (${first[1].toFixed(6)}, ${first[0].toFixed(6)})`);
          logger?.info(`      Polyline last: (${last[1].toFixed(6)}, ${last[0].toFixed(6)})`);
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
   */
  private async fetchTransitDirection(
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

    const transit = data.route?.transit;
    if (transit === undefined || transit === null) {
      throw new Error('Transit route not found in response');
    }

    logger?.info(`  [Transit] Total distance: ${transit.distance}m`);
    logger?.info(`  [Transit] Total duration: ${transit.duration}s`);
    logger?.info(`  [Transit] Segments count: ${transit.segments?.length ?? 0}`);

    // Parse polyline from transit segments
    // Each segment contains walking_steps and riding_steps, each with polyline data
    const polylineCoords = this.parseTransitPolyline(transit.segments, logger);

    const distance = parseInt(transit.distance, 10);
    const duration = parseInt(transit.duration, 10);

    logger?.info(`  [Transit] Parsed result: distance=${distance}m, duration=${duration}s, polyline_points=${polylineCoords.length}`);

    return {
      distanceInMeters: isNaN(distance) ? 0 : distance,
      durationInSeconds: isNaN(duration) ? 0 : duration,
      polylineCoordinates: polylineCoords,
    };
  }

  /**
   * Parse polyline coordinates from transit segments.
   * Transit segments have a different structure: each segment has walking_steps
   * and riding_steps, each with their own polyline strings.
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

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx] as Record<string, unknown>;
      // Walking steps within this transit segment
      const walkingSteps = seg.walking_steps as { polyline?: string }[] | undefined;
      if (walkingSteps && Array.isArray(walkingSteps)) {
        for (const step of walkingSteps) {
          const stepCoords = this.parseSinglePolyline(step.polyline);
          coordinates.push(...stepCoords);
        }
      }

      // Riding steps within this transit segment (bus/subway segments)
      const ridingSteps = seg.riding_steps as { polyline?: string }[] | undefined;
      if (ridingSteps && Array.isArray(ridingSteps)) {
        for (const step of ridingSteps) {
          const stepCoords = this.parseSinglePolyline(step.polyline);
          coordinates.push(...stepCoords);
        }
      }
    }

    if (coordinates.length === 0) {
      logger?.warn('  [Transit] No polyline coordinates parsed from segments');
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
