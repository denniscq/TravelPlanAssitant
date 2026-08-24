import { NextRequest, NextResponse } from 'next/server';
import { rateLimitService } from '../../../../lib/services/RateLimitService';
import { itineraryPlanningService } from '../../../../lib/services/ItineraryPlanningService';
import { extractClientIpAddress } from '../../../../lib/utils/request-ip-extractor';
import { PoiItem } from '../../../../lib/types/poi-types';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface RoutePlanRequest {
  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  endLatitude: number;
  endLongitude: number;
  selectedPois: PoiItem[];
}

function validateRoutePlanRequest(requestBody: unknown): RoutePlanRequest {
  const body = requestBody as Record<string, unknown>;

  if (typeof body?.startLocation !== 'string' || body.startLocation.trim().length === 0) {
    throw new Error('Start location is required.');
  }

  if (typeof body?.endLocation !== 'string' || body.endLocation.trim().length === 0) {
    throw new Error('End location is required.');
  }

  if (
    typeof body.startLatitude !== 'number' ||
    typeof body.startLongitude !== 'number' ||
    isNaN(body.startLatitude) ||
    isNaN(body.startLongitude)
  ) {
    throw new Error('Start location coordinates are required and must be valid numbers.');
  }

  if (
    typeof body.endLatitude !== 'number' ||
    typeof body.endLongitude !== 'number' ||
    isNaN(body.endLatitude) ||
    isNaN(body.endLongitude)
  ) {
    throw new Error('End location coordinates are required and must be valid numbers.');
  }

  if (!Array.isArray(body?.selectedPois)) {
    throw new Error('Selected POIs array is required.');
  }

  return {
    startLocation: body.startLocation.trim(),
    startLatitude: body.startLatitude,
    startLongitude: body.startLongitude,
    endLocation: body.endLocation.trim(),
    endLatitude: body.endLatitude,
    endLongitude: body.endLongitude,
    selectedPois: body.selectedPois,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const clientIp = extractClientIpAddress(request);
    const rateLimitResult = await rateLimitService.checkRateLimit(clientIp);

    if (!rateLimitResult.isAllowed) {
      logger.warn('Rate limit exceeded for IP=' + clientIp);
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please wait before generating another route.',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfterSeconds.toString(),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const requestBody = await request.json();
    const validatedRequest = validateRoutePlanRequest(requestBody);

    logger.info(
      'Route plan request - start=' + validatedRequest.startLocation +
      ', end=' + validatedRequest.endLocation +
      ', pois=' + validatedRequest.selectedPois.length
    );

    const result = await itineraryPlanningService.generateItinerary(
      validatedRequest.startLocation,
      validatedRequest.startLatitude,
      validatedRequest.startLongitude,
      validatedRequest.endLocation,
      validatedRequest.endLatitude,
      validatedRequest.endLongitude,
      validatedRequest.selectedPois,
      logger
    );

    if ('code' in result) {
      logger.error('Route plan generation failed - ' + result.message);
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }

    logger.info('Route plan generated successfully - stops=' + result.stops.length);

    return NextResponse.json({
      success: true,
      data: result,
      rateLimit: {
        remaining: rateLimitResult.remainingPoints,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Route plan request failed - ' + error.message);
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error('Route plan request unexpected error');
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred.',
      },
      { status: 500 }
    );
  }
}