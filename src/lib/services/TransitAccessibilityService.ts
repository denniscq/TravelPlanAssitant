import { getAmapApiKey, getPoiCacheTtlMs } from '../utils/environment';
import { AmapAroundSearchResponse, AmapAroundPoiRaw } from '../types/amap-service-types';
import { ServerLogger } from '../utils/server-logger';

/**
 * AMap POI typecode prefixes:
 *   - 150200 ~ 150299  Bus stations
 *   - 150500 ~ 150700  Subway / metro stations
 *
 * Reference: https://lbs.amap.com/api/webservice/guide/poi/search-poi
 */
const TRANSIT_TYPE_CODES = '150200|150500';

const SEARCH_RADIUS_METERS = 1000;

interface CacheEntry {
  nearestDistanceInMeters: number | null;
  timestamp: number;
}

export interface TransitAccessibilityInput {
  longitude: number;
  latitude: number;
}

export interface TransitAccessibilityResult {
  /** Closest bus/subway station distance in meters. null when none within 1km. */
  nearestStationDistanceInMeters: number | null;
}

export interface CombinedAccessibilityResult {
  feasible: boolean;
  origin: TransitAccessibilityResult;
  destination: TransitAccessibilityResult;
  combinedDistanceInMeters: number;
}

export class TransitAccessibilityService {
  private static readonly AMAP_AROUND_URL = 'https://restapi.amap.com/v5/place/around';

  /**
   * Per-coordinate cache. Key is rounded lng/lat (4 decimals ~ 11m precision)
   * which is enough to dedupe repeated lookups for the same location while
   * keeping cache entries stable across tiny floating-point drift.
   */
  private static cache: Map<string, CacheEntry> = new Map();

  /**
   * Find the closest bus/subway station to a single point.
   * Returns the distance in meters, or null when no station exists within 1km.
   */
  public async findNearestStationDistance(
    point: TransitAccessibilityInput,
    logger?: ServerLogger
  ): Promise<TransitAccessibilityResult> {
    const cacheKey = this.buildCacheKey(point);
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      logger?.info(
        `[TransitAccessibility] cache hit - key=${cacheKey}, nearest=${cached}`
      );
      return { nearestStationDistanceInMeters: cached };
    }

    logger?.info(
      `[TransitAccessibility] querying nearby stations - point=(${point.longitude.toFixed(4)},${point.latitude.toFixed(4)})`
    );

    let nearest: number | null = null;

    try {
      const pois = await this.fetchNearbyStations(point, logger);

      for (const poi of pois) {
        const distance = parseFloat(poi.distance);
        if (isNaN(distance)) continue;
        if (nearest === null || distance < nearest) {
          nearest = distance;
        }
      }
    } catch (error) {
      // On failure, return null so the selector falls back gracefully
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn(`[TransitAccessibility] query failed - ${message}`);
      nearest = null;
    }

    this.setCache(cacheKey, nearest);
    logger?.info(
      `[TransitAccessibility] nearest station = ${nearest === null ? 'none within 1km' : nearest + 'm'}`
    );

    return { nearestStationDistanceInMeters: nearest };
  }

  /**
   * Convenience: check if the combined distance (origin + destination) to the
   * nearest transit stations is within a single threshold.
   *
   * Returns:
   *   - feasible: true when originNearest + destinationNearest <= threshold
   *   - origin / destination: raw values for logging / debugging
   */
  public async checkCombinedAccessibility(
    origin: TransitAccessibilityInput,
    destination: TransitAccessibilityInput,
    thresholdMeters: number,
    logger?: ServerLogger
  ): Promise<CombinedAccessibilityResult> {
    const [originResult, destinationResult] = await Promise.all([
      this.findNearestStationDistance(origin, logger),
      this.findNearestStationDistance(destination, logger),
    ]);

    const originDist = originResult.nearestStationDistanceInMeters ?? Number.POSITIVE_INFINITY;
    const destinationDist = destinationResult.nearestStationDistanceInMeters ?? Number.POSITIVE_INFINITY;
    const combined = originDist + destinationDist;
    const feasible = Number.isFinite(combined) && combined <= thresholdMeters;

    logger?.info(
      `[TransitAccessibility] combined check - origin=${originResult.nearestStationDistanceInMeters}m, ` +
      `destination=${destinationResult.nearestStationDistanceInMeters}m, ` +
      `combined=${Number.isFinite(combined) ? combined + 'm' : 'infinite'}, ` +
      `threshold=${thresholdMeters}m, feasible=${feasible}`
    );

    return {
      feasible,
      origin: originResult,
      destination: destinationResult,
      combinedDistanceInMeters: Number.isFinite(combined) ? combined : Number.POSITIVE_INFINITY,
    };
  }

  private async fetchNearbyStations(
    point: TransitAccessibilityInput,
    logger?: ServerLogger
  ): Promise<AmapAroundPoiRaw[]> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      types: TRANSIT_TYPE_CODES,
      location: `${point.longitude},${point.latitude}`,
      radius: SEARCH_RADIUS_METERS.toString(),
      page_size: '25',
      page_num: '1',
      sortrule: 'distance',
      extensions: 'base',
    });

    const url = `${TransitAccessibilityService.AMAP_AROUND_URL}?${params.toString()}`;

    // Retry loop for transient failures (CUQPS_HAS_EXCEEDED_THE_LIMIT, etc.)
    // with short backoff. AMAP's QPS limit triggers when too many parallel
    // requests fire in a short window — staggering retries usually clears it.
    const MAX_RETRIES = 2;
    const INITIAL_BACKOFF_MS = 500;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url);

      if (!response.ok) {
        const text = await response.text();
        logger?.warn(
          `[TransitAccessibility] AMap HTTP ${response.status} - ${text.slice(0, 200)}`
        );
        return [];
      }

      let data: AmapAroundSearchResponse;
      try {
        data = (await response.json()) as AmapAroundSearchResponse;
      } catch {
        logger?.warn('[TransitAccessibility] AMap returned non-JSON response');
        return [];
      }

      if (data.status === '1') {
        return data.pois ?? [];
      }

      // AMap returns status=0 with an info code describing why. CUQPS_* codes
      // are QPS-related and benefit from a brief retry; everything else we
      // give up on immediately.
      const info = data.info ?? '';
      const isRateLimit = /CUQPS/i.test(info);
      const isLastAttempt = attempt === MAX_RETRIES;
      logger?.warn(`[TransitAccessibility] AMap error status - info=${info}` +
        (isRateLimit && !isLastAttempt ? ' (will retry)' : ''));
      if (!isRateLimit || isLastAttempt) {
        return [];
      }
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    }

    return [];
  }

  private buildCacheKey(point: TransitAccessibilityInput): string {
    return `${point.longitude.toFixed(4)},${point.latitude.toFixed(4)}`;
  }

  private getCached(key: string): number | null | undefined {
    const entry = TransitAccessibilityService.cache.get(key);
    if (entry === undefined) return undefined;
    const ttl = getPoiCacheTtlMs();
    if (Date.now() - entry.timestamp > ttl) {
      TransitAccessibilityService.cache.delete(key);
      return undefined;
    }
    return entry.nearestDistanceInMeters;
  }

  private setCache(key: string, value: number | null): void {
    TransitAccessibilityService.cache.set(key, {
      nearestDistanceInMeters: value,
      timestamp: Date.now(),
    });
  }
}

export const transitAccessibilityService = new TransitAccessibilityService();