import { PoiItem, PoiCategory } from '../types/poi-types';
import { AmapPoiSearchResponse, AmapPoiItem } from '../types/amap-service-types';
import { getAmapApiKey, getPoiCacheTtlMs } from '../utils/environment';
import { ServerLogger } from '../utils/server-logger';

interface CacheEntry {
  items: PoiItem[];
  timestamp: number;
}

export class AmapPoiSearchService {
  private static readonly AMAP_PLACE_SEARCH_URL = 'https://restapi.amap.com/v5/place/text';
  private static readonly AMAP_PLACE_AROUND_URL = 'https://restapi.amap.com/v5/place/around';

  private static readonly CATEGORY_TYPE_MAP: Record<PoiCategory, string> = {
    attraction: '风景名胜',
    restaurant: '餐饮服务',
  };

  private static readonly CATEGORY_LABEL_MAP: Record<PoiCategory, string> = {
    attraction: 'attraction',
    restaurant: 'restaurant',
  };

  private static cache: Map<string, CacheEntry> = new Map();

  public async searchPois(
    cityName: string,
    category: PoiCategory,
    topCount: number,
    logger?: ServerLogger
  ): Promise<PoiItem[]> {
    const cacheKey = `${cityName}:${category}:${topCount}`;
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult !== null) {
      logger?.info('POI search cache hit - key=' + cacheKey + ', count=' + cachedResult.length);
      return cachedResult;
    }

    logger?.info('POI search cache miss - fetching from API - key=' + cacheKey);
    const typeCode = AmapPoiSearchService.CATEGORY_TYPE_MAP[category];
    const allResults = await this.fetchAllPois(cityName, typeCode, topCount, logger);

    const sortedResults = this.sortByRating(allResults);

    const topResults = sortedResults.slice(0, topCount);

    const categoryLabel = AmapPoiSearchService.CATEGORY_LABEL_MAP[category];
    const poiItems = topResults.map((item) =>
      this.mapToPoiItem(item, category, categoryLabel)
    );

    this.setCacheResult(cacheKey, poiItems);

    return poiItems;
  }

  /**
   * Search for POIs near a specific location using AMap Around Search API.
   * Results are sorted by distance from the center location.
   */
  public async searchPoisNearby(
    location: { longitude: number; latitude: number },
    category: 'restaurant',
    topCount: number,
    proximityGroupId: string,
    proximityGroupName: string,
    logger?: ServerLogger
  ): Promise<PoiItem[]> {
    const cacheKey = `nearby:${location.longitude.toFixed(4)},${location.latitude.toFixed(4)}:${category}:${topCount}`;
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult !== null) {
      logger?.info('Nearby POI search cache hit - key=' + cacheKey + ', count=' + cachedResult.length);
      return cachedResult.map((item) => ({
        ...item,
        proximityGroupId,
        proximityGroupName,
      }));
    }

    logger?.info('Nearby POI search cache miss - fetching from API - key=' + cacheKey);
    const typeCode = AmapPoiSearchService.CATEGORY_TYPE_MAP[category];
    const allResults = await this.fetchNearbyPois(location, typeCode, topCount, logger);

    const sortedResults = this.sortByRating(allResults);
    const topResults = sortedResults.slice(0, topCount);

    const categoryLabel = AmapPoiSearchService.CATEGORY_LABEL_MAP[category];
    const poiItems = topResults.map((item) =>
      this.mapToPoiItem(item, category, categoryLabel, proximityGroupId, proximityGroupName)
    );

    this.setCacheResult(cacheKey, topResults.map((item) =>
      this.mapToPoiItem(item, category, categoryLabel)
    ));

    return poiItems;
  }

  private async fetchAllPois(
    cityName: string,
    types: string,
    maxItems: number = 20,
    logger?: ServerLogger
  ): Promise<AmapPoiItem[]> {
    const allPois: AmapPoiItem[] = [];
    let currentPage = 1;
    let totalCount = 0;

    do {
      const response = await this.fetchPoiPage(cityName, types, currentPage);
      if (!response.ok) {
        const text = await response.text();
        logger?.warn('Amap API returned status ' + response.status + ' - ' + text.slice(0, 200));
        break;
      }

      let parsedResponse: AmapPoiSearchResponse;
      try {
        parsedResponse = await response.json();
      } catch {
        logger?.warn('Amap API returned non-JSON response - page=' + currentPage + ', status=' + response.status);
        break;
      }

      if (parsedResponse.status !== '1') {
        logger?.warn('Amap API returned error status - info=' + parsedResponse.info + ', page=' + currentPage);
        break;
      }

      const pois = parsedResponse.pois ?? [];

      // Log raw API response for debugging
      if (logger !== undefined) {
        logger.info('Raw Amap API response - page=' + currentPage + ', count=' + parsedResponse.count + ', sample=' + (pois.length > 0 ? JSON.stringify(pois[0]).slice(0, 500) : 'empty'));
      }

      allPois.push(...pois);

      if (totalCount === 0) {
        totalCount = parseInt(parsedResponse.count, 10);
      }

      // eslint-disable-next-line no-console
      console.log(`[AmapPoiSearchService] Page ${currentPage}: got ${pois.length} POIs, total=${totalCount}, accumulated=${allPois.length}, maxItems=${maxItems}`);

      currentPage++;
      // Keep fetching while there are more pages, up to 10 pages max
    } while (allPois.length < totalCount && currentPage <= 10);

    // Slice to the requested maxItems at the end
    return allPois.slice(0, maxItems);
  }

  private async fetchPoiPage(
    cityName: string,
    types: string,
    page: number
  ): Promise<Response> {
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      types,
      city: cityName,
      page_size: '25',
      page_num: page.toString(),
      city_limit: 'true',
      extensions: 'all',
      show_fields: 'business',
    });

    const url = `${AmapPoiSearchService.AMAP_PLACE_SEARCH_URL}?${params.toString()}`;

    return fetch(url);
  }

  private async fetchNearbyPois(
    location: { longitude: number; latitude: number },
    types: string,
    maxItems: number = 20,
    logger?: ServerLogger
  ): Promise<AmapPoiItem[]> {
    const allPois: AmapPoiItem[] = [];
    let currentPage = 1;
    let totalCount = 0;

    do {
      const params = new URLSearchParams({
        key: getAmapApiKey(),
        types,
        location: `${location.longitude},${location.latitude}`,
        radius: '1000',
        page_size: '25',
        page_num: currentPage.toString(),
        sortrule: 'distance',
        extensions: 'all',
        show_fields: 'business',
      });

      const url = `${AmapPoiSearchService.AMAP_PLACE_AROUND_URL}?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        const text = await response.text();
        logger?.warn('Amap Around API returned status ' + response.status + ' - ' + text.slice(0, 200));
        break;
      }

      let parsedResponse: AmapPoiSearchResponse;
      try {
        parsedResponse = await response.json();
      } catch {
        logger?.warn('Amap Around API returned non-JSON response - page=' + currentPage + ', status=' + response.status);
        break;
      }

      if (parsedResponse.status !== '1') {
        logger?.warn('Amap Around API returned error status - info=' + parsedResponse.info + ', page=' + currentPage);
        break;
      }

      const pois = parsedResponse.pois ?? [];

      // Log raw API response for debugging
      if (logger !== undefined) {
        logger.info('Raw Amap Around API response - page=' + currentPage + ', count=' + parsedResponse.count + ', sample=' + (pois.length > 0 ? JSON.stringify(pois[0]).slice(0, 500) : 'empty'));
      }

      allPois.push(...pois);

      if (totalCount === 0) {
        totalCount = parseInt(parsedResponse.count, 10);
      }

      // eslint-disable-next-line no-console
      console.log(`[AmapPoiSearchService] Nearby page ${currentPage}: got ${pois.length} POIs, total=${totalCount}, accumulated=${allPois.length}, maxItems=${maxItems}`);

      currentPage++;
    } while (allPois.length < totalCount && allPois.length < maxItems && currentPage <= 10);

    return allPois.slice(0, maxItems);
  }

  private sortByRating(pois: AmapPoiItem[]): AmapPoiItem[] {
    return [...pois].sort((a, b) => {
      const ratingA = parseFloat(a.business?.rating ?? '') || 0;
      const ratingB = parseFloat(b.business?.rating ?? '') || 0;
      return ratingB - ratingA;
    });
  }

  private mapToPoiItem(
    item: AmapPoiItem,
    category: PoiCategory,
    categoryLabel: string,
    proximityGroupId?: string,
    proximityGroupName?: string
  ): PoiItem {
    const [longitude, latitude] = item.location.split(',').map(Number);
    const biz = item.business;

    // Parse tags: prefer business.keytag/rectag, fallback to old top-level tag
    let tagStr = '';
    if (biz?.keytag !== undefined && biz.keytag.length > 0) {
      tagStr = biz.keytag;
    } else if (biz?.rectag !== undefined && biz.rectag.length > 0) {
      tagStr = biz.rectag;
    }

    return {
      id: item.id,
      name: item.name,
      category,
      latitude,
      longitude,
      address: item.address,
      cityName: item.cityname,
      districtName: item.adname,
      provinceName: item.pname,
      adcode: item.adcode,
      rating: parseFloat(biz?.rating ?? '') || 0,
      cost: parseFloat(biz?.cost ?? '') || 0,
      openingTime: biz?.opentime_today ?? '',
      openingTimeToday: biz?.opentime_today ?? '',
      openingTimeWeek: biz?.opentime_week ?? '',
      telephone: biz?.tel ?? '',
      tags: tagStr.length > 0 ? tagStr.split('|').filter(Boolean) : [],
      typeLabel: categoryLabel,
      typeCode: item.typecode,
      photoUrls: (item.photos ?? []).map((photo) => photo.url),
      businessArea: biz?.business_area ?? '',
      website: '',
      email: '',
      distance: parseFloat(item.distance) || 0,
      alias: biz?.alias ?? '',
      proximityGroupId,
      proximityGroupName,
    };
  }

  private getCachedResult(cacheKey: string): PoiItem[] | null {
    const entry = AmapPoiSearchService.cache.get(cacheKey);
    if (entry === undefined) {
      return null;
    }

    const ttl = getPoiCacheTtlMs();
    const isExpired = Date.now() - entry.timestamp > ttl;

    if (isExpired) {
      AmapPoiSearchService.cache.delete(cacheKey);
      return null;
    }

    return entry.items;
  }

  private setCacheResult(cacheKey: string, items: PoiItem[]): void {
    AmapPoiSearchService.cache.set(cacheKey, {
      items,
      timestamp: Date.now(),
    });
  }
}

export const amapPoiSearchService = new AmapPoiSearchService();