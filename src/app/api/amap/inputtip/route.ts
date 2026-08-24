import { NextRequest, NextResponse } from 'next/server';
import { getAmapApiKey } from '../../../../lib/utils/environment';
import { AmapPoiSearchResponse } from '../../../../lib/types/amap-service-types';
import { createServerLogger } from '../../../../lib/utils/server-logger';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const { searchParams } = new URL(request.url);
    const keywords = searchParams.get('keywords') ?? '';

    if (keywords.trim().length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Use Place Text Search API (/v3/place/text) instead of Inputtip (/v3/assistant/input/tips)
    // because Inputtip may not be enabled for all AMap keys.
    // Do NOT pass city/city_limit — let the keywords determine search scope.
    const params = new URLSearchParams({
      key: getAmapApiKey(),
      keywords,
      offset: '10',
      page: '1',
      extensions: 'base',
    });

    const url = `https://restapi.amap.com/v3/place/text?${params.toString()}`;
    const response = await fetch(url);
    const data: AmapPoiSearchResponse = await response.json();

    if (data.status !== '1') {
      logger.warn('Place text search failed - ' + data.info + ', keywords=' + keywords);
      return NextResponse.json({ success: true, data: [] });
    }

    const results = (data.pois ?? []).map((poi) => ({
      name: poi.name ?? '未知',
      address: poi.address ?? '',
      location: poi.location ?? '0,0',
      district: poi.adname ?? '',
      adcode: '',
    }));

    logger.info('Place text search results - keywords=' + keywords + ', count=' + results.length);
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    logger.error('Place text search error - ' + String(error));
    return NextResponse.json({ success: true, data: [] });
  }
}