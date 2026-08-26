import { describe, it, expect } from 'vitest';
import { AmapRouteCalculationService } from './AmapRouteCalculationService';
import type { TransitLegDetail } from '../types/itinerary-types';

// We test the private parsers via a typed cast. The parser functions are pure
// and only depend on their input, so direct testing is safe and stable.
const service = new AmapRouteCalculationService();
const privateApi = service as unknown as {
  parseBusline: (raw: unknown, logger?: unknown) => TransitLegDetail | null;
  parseRailwayTrip: (raw: unknown, logger?: unknown) => TransitLegDetail | null;
  parseTransitLegDetails: (
    itinerary: unknown,
    logger?: unknown
  ) => {
    transitLegs: TransitLegDetail[];
    transitFee: number | undefined;
    walkingLegs: { distanceMeters: number; durationSeconds: number; instruction: string }[];
  };
};

describe('AmapRouteCalculationService — parseBusline', () => {
  it('maps a subway line to a structured TransitLegDetail', () => {
    const raw = {
      name: '1号线',
      type: '地铁线路',
      departure_stop: { name: '天安门东站', id: 'd1', location: '116.40,39.91' },
      arrival_stop: { name: '王府井站', id: 'a1', location: '116.41,39.91' },
      distance: '4100',
      duration: '1080',
      via_num: '3',
      start_time: '0530',
      end_time: '2330',
    };
    const result = privateApi.parseBusline(raw);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      transportType: 'subway',
      lineName: '1号线',
      departureStopName: '天安门东站',
      arrivalStopName: '王府井站',
      viaStopCount: 3,
      startTime: '0530',
      endTime: '2330',
      distanceMeters: 4100,
      durationSeconds: 1080,
    });
  });

  it('maps a bus line to transportType=bus', () => {
    const raw = {
      name: '445路(南十里居--地铁望京西站)',
      type: '公交线路',
      departure_stop: { name: '南十里居', id: 'd2', location: '116.47,39.99' },
      arrival_stop: { name: '地铁望京西站', id: 'a2', location: '116.46,39.99' },
      distance: '6500',
      duration: '1800',
      via_num: '12',
    };
    const result = privateApi.parseBusline(raw);
    expect(result?.transportType).toBe('bus');
    expect(result?.lineName).toBe('445路(南十里居--地铁望京西站)');
    expect(result?.viaStopCount).toBe(12);
  });

  it('falls back to bus when type is missing or unknown', () => {
    const raw = {
      name: 'Unknown Route',
      departure_stop: { name: 'A' },
      arrival_stop: { name: 'B' },
      distance: '1000',
      duration: '600',
    };
    const result = privateApi.parseBusline(raw);
    expect(result?.transportType).toBe('bus');
    expect(result?.startTime).toBe('');
    expect(result?.endTime).toBe('');
  });

  it('returns null when required fields are missing', () => {
    const raw = { name: '', departure_stop: { name: 'A' }, arrival_stop: { name: 'B' } };
    expect(privateApi.parseBusline(raw)).toBeNull();

    const raw2 = { name: 'X', departure_stop: {}, arrival_stop: { name: 'B' } };
    expect(privateApi.parseBusline(raw2)).toBeNull();
  });

  it('coerces non-numeric via_num/distance/duration to 0', () => {
    const raw = {
      name: 'Test',
      departure_stop: { name: 'A' },
      arrival_stop: { name: 'B' },
      distance: 'abc',
      duration: '',
      via_num: 'NaN',
    };
    const result = privateApi.parseBusline(raw);
    expect(result?.distanceMeters).toBe(0);
    expect(result?.durationSeconds).toBe(0);
    expect(result?.viaStopCount).toBe(0);
  });
});

describe('AmapRouteCalculationService — parseRailwayTrip', () => {
  it('parses a railway trip with stops', () => {
    const raw = {
      id: 'G101',
      name: 'G101',
      time: '1800',
      trip: 'G101',
      distance: '120000',
      departure_stop: { name: '北京南站' },
      arrival_stop: { name: '上海虹桥站' },
    };
    const result = privateApi.parseRailwayTrip(raw);
    expect(result).toEqual({
      transportType: 'railway',
      lineName: 'G101',
      departureStopName: '北京南站',
      arrivalStopName: '上海虹桥站',
      viaStopCount: 0,
      startTime: '',
      endTime: '',
      distanceMeters: 120000,
      durationSeconds: 1800,
    });
  });

  it('returns null when name is missing', () => {
    expect(privateApi.parseRailwayTrip({})).toBeNull();
  });
});

describe('AmapRouteCalculationService — parseTransitLegDetails', () => {
  it('extracts subway leg, walking leg, and total fee from a single-segment itinerary', () => {
    const itinerary = {
      cost: '3',
      duration: '1500',
      distance: '4500',
      segments: [
        {
          // Real AMap returns only ONE walking leg per segment (origin-walk +
          // destination-walk are separate segments). For an itinerary with
          // exactly one subway ride, we expect one walking leg.
          walking: {
            distance: '300',
            duration: '240',
            steps: [
              { instruction: '向东步行 200 米至 天安门东站 A 口' },
              { instruction: '进入地铁站' },
            ],
          },
          subway: {
            buslines: [
              {
                name: '1号线',
                type: '地铁线路',
                departure_stop: { name: '天安门东站' },
                arrival_stop: { name: '王府井站' },
                distance: '4100',
                duration: '1080',
                via_num: '3',
                start_time: '0530',
                end_time: '2330',
              },
            ],
          },
        },
      ],
    };
    const result = privateApi.parseTransitLegDetails(itinerary);
    expect(result.transitFee).toBe(3);
    expect(result.transitLegs).toHaveLength(1);
    expect(result.transitLegs[0].lineName).toBe('1号线');
    expect(result.transitLegs[0].transportType).toBe('subway');
    expect(result.walkingLegs).toHaveLength(1);
    expect(result.walkingLegs[0].distanceMeters).toBe(300);
    expect(result.walkingLegs[0].instruction).toContain('天安门东站');
  });

  it('extracts bus + bus (transfer) itinerary with fee and combined legs', () => {
    const itinerary = {
      cost: '4',
      segments: [
        {
          // Segment 1: walk to station + take bus 1
          walking: { distance: '200', duration: '180', steps: [] },
          bus: {
            buslines: [
              {
                name: '1路',
                type: '公交线路',
                departure_stop: { name: 'A站' },
                arrival_stop: { name: 'B站' },
                distance: '3000',
                duration: '900',
                via_num: '5',
              },
            ],
          },
        },
        {
          // Segment 2: walk + bus 2 + walk to destination
          walking: { distance: '100', duration: '90', steps: [] },
          bus: {
            buslines: [
              {
                name: '5路',
                type: '公交线路',
                departure_stop: { name: 'B站' },
                arrival_stop: { name: 'C站' },
                distance: '2000',
                duration: '720',
                via_num: '4',
              },
            ],
          },
        },
      ],
    };
    const result = privateApi.parseTransitLegDetails(itinerary);
    expect(result.transitFee).toBe(4);
    expect(result.transitLegs).toHaveLength(2);
    expect(result.transitLegs.map((l) => l.lineName)).toEqual(['1路', '5路']);
    expect(result.walkingLegs).toHaveLength(2);
  });

  it('returns empty arrays and undefined fee when itinerary has no segments', () => {
    const result = privateApi.parseTransitLegDetails({});
    expect(result.transitLegs).toEqual([]);
    expect(result.transitFee).toBeUndefined();
    expect(result.walkingLegs).toEqual([]);
  });

  it('handles missing cost field gracefully', () => {
    const result = privateApi.parseTransitLegDetails({ segments: [] });
    expect(result.transitFee).toBeUndefined();
  });

  it('handles malformed cost string gracefully', () => {
    const result = privateApi.parseTransitLegDetails({ cost: 'NaN', segments: [] });
    expect(result.transitFee).toBeUndefined();
  });

  it('skips malformed buslines without required fields, keeps the rest', () => {
    const itinerary = {
      segments: [
        {
          bus: {
            buslines: [
              { name: 'Good', type: '公交线路', departure_stop: { name: 'A' }, arrival_stop: { name: 'B' } },
              { name: '', departure_stop: { name: 'A' }, arrival_stop: { name: 'B' } }, // missing name
              { name: 'NoArrival', type: '公交线路', departure_stop: { name: 'A' } }, // missing arrival
              { name: 'AlsoGood', type: '公交线路', departure_stop: { name: 'X' }, arrival_stop: { name: 'Y' } },
            ],
          },
        },
      ],
    };
    const result = privateApi.parseTransitLegDetails(itinerary);
    expect(result.transitLegs).toHaveLength(2);
    expect(result.transitLegs.map((l) => l.lineName)).toEqual(['Good', 'AlsoGood']);
  });
});
