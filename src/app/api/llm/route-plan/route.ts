import { NextRequest, NextResponse } from 'next/server';
import { rateLimitService } from '../../../../lib/services/RateLimitService';
import { itineraryPlanningService } from '../../../../lib/services/ItineraryPlanningService';
import { routePlanQueue, QueueFullError } from '../../../../lib/services/RoutePlanQueue';
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

    // Parse + validate the request body. If the client aborted (browser
    // refresh, StrictMode double-mount, network drop) the body may be
    // truncated or empty — log a warning instead of ERROR and bail out
    // cleanly so the log isn't polluted by retry noise.
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Route plan request body could not be parsed (client likely aborted) - ' + message);
      // Client has likely already navigated away — return 200 with a noop
      // body so the network call completes cleanly. NextResponse.json does
      // not allow status 204 (Response throws on that combo), so 200 is the
      // safest, no-error choice.
      return NextResponse.json({ aborted: true });
    }
    const validatedRequest = validateRoutePlanRequest(requestBody);

    logger.info(
      'Route plan request - start=' + validatedRequest.startLocation +
      ', end=' + validatedRequest.endLocation +
      ', pois=' + validatedRequest.selectedPois.length
    );

    // Wrap the expensive itinerary generation in the request queue so
    // concurrent clients don't fight for upstream QPS (LLM 30-90s +
    // multiple AMap calls). Queue rejects immediately with
    // QueueFullError when waiting reaches ROUTE_PLAN_QUEUE_MAX_LENGTH,
    // in which case we return 429 + Retry-After so the client backs
    // off without holding a a slot.
    let result;
    try {
        result = await routePlanQueue.enqueue(() =>
          itineraryPlanningService.generateItinerary(
            validatedRequest.startLocation,
            validatedRequest.startLatitude,
            validatedRequest.startLongitude,
            validatedRequest.endLocation,
            validatedRequest.endLatitude,
            validatedRequest.endLongitude,
            validatedRequest.selectedPois,
            logger,
          ),
        );
      } catch (queueErr) {
        if (queueErr instanceof QueueFullError) {
          const stats = routePlanQueue.getStats();
          logger.warn(
            'Route plan queue is full - rejecting request. stats=' +
              JSON.stringify(stats),
          );
          return NextResponse.json(
            {
              success: false,
              error: 'Server is busy. Please retry shortly.',
            },
            {
              status: 429,
              headers: {
                'Retry-After': '10',
              },
            },
          );
        }
        throw queueErr;
      }

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
      // JSON parse failures here mean the client aborted — not a server
      // problem. Demote to WARN so the log doesn't alarm on retries.
      const isAbort = error instanceof SyntaxError;
      if (isAbort) {
        logger.warn('Route plan request aborted by client - ' + error.message);
        return NextResponse.json({ aborted: true });
      }
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