import { NextRequest, NextResponse } from 'next/server';
import { amapPoiSearchService } from '../../../../lib/services/AmapPoiSearchService';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface PlaceAroundRequest {
  location: { longitude: number; latitude: number };
  category: 'restaurant';
  limit: number;
  proximityGroupId: string;
  proximityGroupName: string;
}

function validatePlaceAroundRequest(requestBody: unknown): PlaceAroundRequest {
  const body = requestBody as Record<string, unknown>;

  if (
    typeof body?.location !== 'object' ||
    body.location === null
  ) {
    throw new Error('Location is required and must be an object with longitude and latitude.');
  }

  const location = body.location as Record<string, unknown>;
  const longitude = typeof location.longitude === 'number' ? location.longitude : parseFloat(String(location.longitude ?? ''));
  const latitude = typeof location.latitude === 'number' ? location.latitude : parseFloat(String(location.latitude ?? ''));

  if (isNaN(longitude) || isNaN(latitude)) {
    throw new Error('Location must contain valid longitude and latitude numbers.');
  }

  const category = body.category as string;
  if (category !== 'restaurant') {
    throw new Error('Category must be "restaurant".');
  }

  const limit = typeof body.limit === 'number' ? body.limit : parseInt(String(body.limit ?? '10'), 10);
  const clampedLimit = Math.max(1, Math.min(50, limit));

  if (typeof body.proximityGroupId !== 'string' || body.proximityGroupId.trim().length === 0) {
    throw new Error('proximityGroupId is required.');
  }

  if (typeof body.proximityGroupName !== 'string' || body.proximityGroupName.trim().length === 0) {
    throw new Error('proximityGroupName is required.');
  }

  return {
    location: { longitude, latitude },
    category,
    limit: clampedLimit,
    proximityGroupId: body.proximityGroupId.trim(),
    proximityGroupName: body.proximityGroupName.trim(),
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
      logger.warn('Nearby POI search request body could not be parsed (client likely aborted) - ' + message);
      return NextResponse.json({ aborted: true });
    }
    const validatedRequest = validatePlaceAroundRequest(requestBody);

    logger.info(
      'Nearby POI search request - location=' +
        validatedRequest.location.longitude.toFixed(4) +
        ',' +
        validatedRequest.location.latitude.toFixed(4) +
        ', category=' +
        validatedRequest.category +
        ', limit=' +
        validatedRequest.limit +
        ', group=' +
        validatedRequest.proximityGroupName
    );

    const pois = await amapPoiSearchService.searchPoisNearby(
      validatedRequest.location,
      validatedRequest.category,
      validatedRequest.limit,
      validatedRequest.proximityGroupId,
      validatedRequest.proximityGroupName,
      logger
    );

    logger.info('Nearby POI search result - count=' + pois.length + ' POIs found');

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
        logger.warn('Nearby POI search aborted by client - ' + error.message);
        return NextResponse.json({ aborted: true });
      }
      logger.error('Nearby POI search failed - ' + error.message);
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error('Nearby POI search unexpected error');
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred.',
      },
      { status: 500 }
    );
  }
}