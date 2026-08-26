import { NextRequest, NextResponse } from 'next/server';
import { amapPoiSearchService } from '../../../../lib/services/AmapPoiSearchService';
import { PoiCategory } from '../../../../lib/types/poi-types';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface PlaceSearchRequest {
  city: string;
  category: PoiCategory;
  limit: number;
}

function validatePlaceSearchRequest(requestBody: unknown): PlaceSearchRequest {
  const body = requestBody as Record<string, unknown>;

  if (typeof body?.city !== 'string' || body.city.trim().length === 0) {
    throw new Error('City name is required and must be a non-empty string.');
  }

  const category = body.category as string;
  if (category !== 'attraction' && category !== 'restaurant') {
    throw new Error('Category must be either "attraction" or "restaurant".');
  }

  const limit = typeof body.limit === 'number' ? body.limit : parseInt(String(body.limit ?? '10'), 10);
  const clampedLimit = Math.max(1, Math.min(50, limit));

  return {
    city: body.city.trim(),
    category,
    limit: clampedLimit,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    // Parse + validate the request body. JSON parse failures here mean
    // the client aborted — log a warning and return a no-op instead of
    // raising ERROR noise in the logs.
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('POI search request body could not be parsed (client likely aborted) - ' + message);
      return NextResponse.json({ aborted: true });
    }
    const validatedRequest = validatePlaceSearchRequest(requestBody);

    logger.info('POI search request - city=' + validatedRequest.city + ', category=' + validatedRequest.category + ', limit=' + validatedRequest.limit);

    const pois = await amapPoiSearchService.searchPois(
      validatedRequest.city,
      validatedRequest.category,
      validatedRequest.limit,
      logger
    );

    logger.info('POI search result - count=' + pois.length + ' POIs found');

    return NextResponse.json({
      success: true,
      data: pois,
      count: pois.length,
    });
  } catch (error) {
    if (error instanceof Error) {
      // Demote JSON parse errors thrown past the inner try/catch (e.g. by
      // middleware) to a WARN — they indicate a client abort, not a
      // server bug.
      if (error instanceof SyntaxError) {
        logger.warn('POI search aborted by client - ' + error.message);
        return NextResponse.json({ aborted: true });
      }
      logger.error('POI search failed - ' + error.message);
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error('POI search unexpected error');
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred.',
      },
      { status: 500 }
    );
  }
}