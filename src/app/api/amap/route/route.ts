import { NextRequest, NextResponse } from 'next/server';
import { amapRouteCalculationService } from '../../../../lib/services/AmapRouteCalculationService';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface RouteCalculationRequest {
  points: { latitude: number; longitude: number }[];
}

function validateRouteCalculationRequest(requestBody: unknown): RouteCalculationRequest {
  const body = requestBody as Record<string, unknown>;

  if (!Array.isArray(body?.points)) {
    throw new Error('Points array is required.');
  }

  if (body.points.length < 2) {
    throw new Error('At least 2 points are required for route calculation.');
  }

  for (const point of body.points) {
    if (
      typeof point.latitude !== 'number' ||
      typeof point.longitude !== 'number' ||
      isNaN(point.latitude) ||
      isNaN(point.longitude)
    ) {
      throw new Error('Each point must have valid latitude and longitude numbers.');
    }
  }

  return {
    points: body.points as { latitude: number; longitude: number }[],
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const requestBody = await request.json();
    const validatedRequest = validateRouteCalculationRequest(requestBody);

    logger.info('Route calculation request - points=' + validatedRequest.points.length);

    const segmentRequests = [];
    for (let i = 0; i < validatedRequest.points.length - 1; i++) {
      segmentRequests.push({
        origin: validatedRequest.points[i],
        destination: validatedRequest.points[i + 1],
        transportMode: 'driving' as const,
      });
    }

    const segments = await amapRouteCalculationService.calculateRouteSegments(
      segmentRequests,
      logger
    );

    logger.info('Route calculation result - segments=' + segments.length);

    return NextResponse.json({
      success: true,
      data: segments,
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Route calculation failed - ' + error.message);
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error('Route calculation unexpected error');
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred.',
      },
      { status: 500 }
    );
  }
}