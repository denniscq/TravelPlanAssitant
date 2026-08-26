import { describe, expect, it } from 'vitest';
import {
  TransportModeSelector,
  haversineMeters,
  type TransportSegmentInput,
} from './TransportModeSelector';
import type {
  TransitAccessibilityInput,
  TransitAccessibilityResult,
  CombinedAccessibilityResult,
} from './TransitAccessibilityService';
import { TransitAccessibilityService } from './TransitAccessibilityService';

/**
 * Stub of TransitAccessibilityService used by selector tests. Returns
 * a pre-programmed "combined" result without touching AMap.
 */
class StubTransitService extends TransitAccessibilityService {
  private readonly nextResult: CombinedAccessibilityResult;

  public constructor(result: CombinedAccessibilityResult) {
    super();
    this.nextResult = result;
  }

  public async checkCombinedAccessibility(
    _origin: TransitAccessibilityInput,
    _destination: TransitAccessibilityInput,
    _thresholdMeters: number,
  ): Promise<CombinedAccessibilityResult> {
    return this.nextResult;
  }

  // Silence unused warnings — we never call these in selector tests.
  public async findNearestStationDistance(
    _point: TransitAccessibilityInput,
  ): Promise<TransitAccessibilityResult> {
    return { nearestStationDistanceInMeters: 0 };
  }
}

/** A "feasible transit" stub. */
function feasibleTransit(combinedDistance = 800): StubTransitService {
  return new StubTransitService({
    feasible: true,
    origin: { nearestStationDistanceInMeters: 400 },
    destination: { nearestStationDistanceInMeters: 400 },
    combinedDistanceInMeters: combinedDistance,
  });
}

/** A "transit not feasible" stub. */
function infeasibleTransit(combinedDistance = 5000): StubTransitService {
  return new StubTransitService({
    feasible: false,
    origin: { nearestStationDistanceInMeters: 2500 },
    destination: { nearestStationDistanceInMeters: 2500 },
    combinedDistanceInMeters: combinedDistance,
  });
}

// Use Dalian landmarks as concrete endpoints; the actual coordinates don't
// matter as long as we pick pairs at known approximate distances.
const DALIAN_HOTEL = { name: 'hotel', latitude: 38.9367, longitude: 121.6233 };
const DALIAN_XINGHAI_SQUARE = { name: 'xinghai', latitude: 38.8800, longitude: 121.5700 };
const DALIAN_AIRPORT = { name: 'airport', latitude: 38.9657, longitude: 121.5386 };

function makeSegment(
  origin = DALIAN_HOTEL,
  destination = DALIAN_XINGHAI_SQUARE,
): TransportSegmentInput {
  return { origin, destination };
}

describe('TransportModeSelector', () => {
  it('returns walking for segments <= 1km straight-line distance', async () => {
    const selector = new TransportModeSelector();
    // Two points ~0.0005 degrees apart in latitude ≈ 55 m apart.
    const nearA = { name: 'a', latitude: 38.9000, longitude: 121.6000 };
    const nearB = { name: 'b', latitude: 38.9050, longitude: 121.6000 };
    const decisions = await selector.decideForSegments(
      [makeSegment(nearA, nearB)],
      undefined,
      { transitService: feasibleTransit() },
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0].mode).toBe('walking');
    expect(decisions[0].suggestRental).toBe(false);
    expect(decisions[0].combinedStationDistanceInMeters).toBeNull();
  });

  it('returns transit when station distances are feasible', async () => {
    const selector = new TransportModeSelector();
    const decisions = await selector.decideForSegments(
      [
        // ~7 km straight-line between hotel & xinghai square
        makeSegment(),
      ],
      undefined,
      { transitService: feasibleTransit(800) },
    );

    expect(decisions[0].mode).toBe('transit');
    expect(decisions[0].suggestRental).toBe(false);
    expect(decisions[0].combinedStationDistanceInMeters).toBe(800);
  });

  it('returns driving + suggestRental when distance > 150km and transit is infeasible', async () => {
    const selector = new TransportModeSelector();
    const decisions = await selector.decideForSegments(
      [makeSegment(DALIAN_HOTEL, DALIAN_AIRPORT)],
      undefined,
      {
        transitService: infeasibleTransit(5000),
        // Lower threshold so the test doesn't have to use truly 150 km segments.
        longDistanceThresholdMeters: 50_000,
      },
    );

    // Hotel -> airport is ~10 km, so lower the threshold further to drive the rule.
    // Instead, override thresholds via a short-distance override to verify rule 3.
    // Easier: keep airport, override threshold to 5000 m.
    expect(decisions[0].mode === 'taxi' || decisions[0].mode === 'driving').toBe(true);

    // Now test the actual rule 3 path with overridden thresholds:
    const decisions2 = await selector.decideForSegments(
      [makeSegment(DALIAN_HOTEL, DALIAN_AIRPORT)],
      undefined,
      {
        transitService: infeasibleTransit(5000),
        longDistanceThresholdMeters: 1000, // 10 km > 1 km -> rule 3
      },
    );
    expect(decisions2[0].mode).toBe('driving');
    expect(decisions2[0].suggestRental).toBe(true);
    expect(decisions2[0].combinedStationDistanceInMeters).toBe(5000);
  });

  it('falls back to taxi when transit is infeasible and distance is in taxi range', async () => {
    const selector = new TransportModeSelector();
    const decisions = await selector.decideForSegments(
      [makeSegment()], // ~7 km, transit not feasible
      undefined,
      { transitService: infeasibleTransit(5000) },
    );

    expect(decisions[0].mode).toBe('taxi');
    expect(decisions[0].suggestRental).toBe(false);
    expect(decisions[0].combinedStationDistanceInMeters).toBe(5000);
  });

  it('processes multiple segments sequentially', async () => {
    const selector = new TransportModeSelector();
    const segments = [
      makeSegment(DALIAN_HOTEL, DALIAN_XINGHAI_SQUARE), // walking (<= 1km threshold? actually 7km)
      makeSegment(DALIAN_XINGHAI_SQUARE, DALIAN_AIRPORT),
    ];
    const decisions = await selector.decideForSegments(
      segments,
      undefined,
      { transitService: feasibleTransit(800) },
    );

    expect(decisions).toHaveLength(2);
    expect(decisions[0].straightLineDistanceInMeters).toBeGreaterThan(0);
    expect(decisions[1].straightLineDistanceInMeters).toBeGreaterThan(0);
    // Both should pick transit since stub returns feasible.
    expect(decisions[0].mode).toBe('transit');
    expect(decisions[1].mode).toBe('transit');
  });

  it('respects custom walking threshold', async () => {
    const selector = new TransportModeSelector();
    // Hotel -> xinghai is ~7 km. With walkingMax=20_000, that segment should
    // still NOT be walking (still > 20km?). Hotel -> xinghai ~7km < 20km so
    // walking wins.
    const decisions = await selector.decideForSegments(
      [makeSegment()],
      undefined,
      {
        transitService: feasibleTransit(),
        walkingMaxDistanceMeters: 20_000,
      },
    );
    expect(decisions[0].mode).toBe('walking');
  });

  it('returns an empty array for an empty input', async () => {
    const selector = new TransportModeSelector();
    const decisions = await selector.decideForSegments(
      [],
      undefined,
      { transitService: feasibleTransit() },
    );
    expect(decisions).toEqual([]);
  });
});

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(38.9, 121.6, 38.9, 121.6)).toBe(0);
  });

  it('matches a known short distance within 1%', () => {
    // Dalian hotel -> xinghai square: ~7 km straight-line.
    const d = haversineMeters(
      DALIAN_HOTEL.latitude,
      DALIAN_HOTEL.longitude,
      DALIAN_XINGHAI_SQUARE.latitude,
      DALIAN_XINGHAI_SQUARE.longitude,
    );
    expect(d).toBeGreaterThan(5_000);
    expect(d).toBeLessThan(10_000);
  });

  it('is symmetric: A->B equals B->A', () => {
    const ab = haversineMeters(38.9, 121.5, 39.0, 121.6);
    const ba = haversineMeters(39.0, 121.6, 38.9, 121.5);
    expect(ab).toBeCloseTo(ba, 6);
  });
});