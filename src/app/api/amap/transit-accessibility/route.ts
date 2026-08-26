import { NextRequest, NextResponse } from 'next/server';
import { transitAccessibilityService } from '../../../../lib/services/TransitAccessibilityService';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface TransitAccessibilityRequest {
  origin: { longitude: number; latitude: number };
  destination: { longitude: number; latitude: number };
  thresholdMeters?: number;
}

function validateRequest(body: unknown): TransitAccessibilityRequest {
  const obj = body as Record<string, unknown>;

  const parseCoord = (raw: unknown): { longitude: number; latitude: number } => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Coordinate must be an object with longitude and latitude.');
    }
    const coord = raw as Record<string, unknown>;
    const lng = typeof coord.longitude === 'number' ? coord.longitude : parseFloat(String(coord.longitude ?? ''));
    const lat = typeof coord.latitude === 'number' ? coord.latitude : parseFloat(String(coord.latitude ?? ''));
    if (isNaN(lng) || isNaN(lat)) {
      throw new Error('Coordinate must contain valid longitude and latitude numbers.');
    }
    return { longitude: lng, latitude: lat };
  };

  const origin = parseCoord(obj?.origin);
  const destination = parseCoord(obj?.destination);

  let thresholdMeters: number | undefined;
  if (obj?.thresholdMeters !== undefined) {
    const raw = typeof obj.thresholdMeters === 'number'
      ? obj.thresholdMeters
      : parseFloat(String(obj.thresholdMeters));
    if (!isNaN(raw) && raw > 0) {
      thresholdMeters = raw;
    }
  }

  return { origin, destination, thresholdMeters };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const body = await request.json();
    const validated = validateRequest(body);

    const threshold = validated.thresholdMeters ?? 1000;
    logger.info(
      `Transit accessibility request - threshold=${threshold}m, ` +
      `origin=(${validated.origin.longitude.toFixed(4)},${validated.origin.latitude.toFixed(4)}), ` +
      `destination=(${validated.destination.longitude.toFixed(4)},${validated.destination.latitude.toFixed(4)})`
    );

    const result = await transitAccessibilityService.checkCombinedAccessibility(
      validated.origin,
      validated.destination,
      threshold,
      logger
    );

    logger.info(
      `Transit accessibility result - feasible=${result.feasible}, ` +
      `combined=${result.combinedDistanceInMeters}m`
    );

    return NextResponse.json({
      success: true,
      data: {
        feasible: result.feasible,
        origin: result.origin,
        destination: result.destination,
        combinedDistanceInMeters: result.combinedDistanceInMeters,
        thresholdMeters: threshold,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Transit accessibility request failed - ' + error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    logger.error('Transit accessibility unexpected error');
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}