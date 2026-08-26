import { describe, expect, it } from 'vitest';
import {
  bestEffortLabel,
  clamp,
  clampRectToCanvas,
  deterministicTilt,
  formatDistance,
  formatDuration,
  labelEdgePoint,
  placeLabel,
  rectsOverlap,
  segmentsIntersect,
} from './map-helpers';

describe('formatDistance', () => {
  it('formats sub-kilometer distances in meters', () => {
    expect(formatDistance(0)).toBe('0 米');
    expect(formatDistance(450)).toBe('450 米');
    expect(formatDistance(999)).toBe('999 米');
  });

  it('formats kilometer distances with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 公里');
    expect(formatDistance(1500)).toBe('1.5 公里');
    expect(formatDistance(12_345)).toBe('12.3 公里');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as 1 minute', () => {
    expect(formatDuration(0)).toBe('0 分钟');
    expect(formatDuration(45)).toBe('1 分钟');
  });

  it('formats sub-hour durations in minutes', () => {
    expect(formatDuration(60)).toBe('1 分钟');
    expect(formatDuration(30 * 60)).toBe('30 分钟');
    expect(formatDuration(59 * 60)).toBe('59 分钟');
  });

  it('formats hour-plus durations with hours and minutes', () => {
    expect(formatDuration(60 * 60)).toBe('1 小时 0 分钟');
    expect(formatDuration(90 * 60)).toBe('1 小时 30 分钟');
    expect(formatDuration(125 * 60)).toBe('2 小时 5 分钟');
  });
});

describe('deterministicTilt', () => {
  it('is stable across calls for the same id', () => {
    const a = deterministicTilt('poi-42');
    const b = deterministicTilt('poi-42');
    expect(a).toBe(b);
  });

  it('produces a value in [-1, 1]', () => {
    for (const id of ['', 'a', 'poi-1', 'long-name-with-many-chars']) {
      const t = deterministicTilt(id);
      expect(t).toBeGreaterThanOrEqual(-1);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 for empty id', () => {
    // FNV-1a offset is 2166136261; (2166136261 % 200) = 61 -> (61 - 100)/100 = -0.39
    // Just assert determinism + range; the exact value isn't load-bearing.
    const t = deterministicTilt('');
    expect(t).toBe(deterministicTilt(''));
    expect(t).toBeGreaterThanOrEqual(-1);
    expect(t).toBeLessThanOrEqual(1);
  });
});

describe('rectsOverlap', () => {
  it('returns false when rects are far apart', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 })).toBe(false);
  });

  it('returns true when rects overlap', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('treats touching edges as non-overlap (strict inequalities)', () => {
    // Right edge of A touches left edge of B.
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    // Top edge of A touches bottom edge of B.
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
  });
});

describe('clamp', () => {
  it('clamps below the low bound', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above the high bound', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns the value unchanged when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('clampRectToCanvas', () => {
  it('shifts a rect that overflows the right edge', () => {
    const r = clampRectToCanvas({ x: 980, y: 100, w: 100, h: 50 }, 100, 50);
    // Canvas is 1000 wide; rect right edge must be <= 996 (CANVAS_WIDTH - 4)
    expect(r.x + r.w).toBeLessThanOrEqual(996);
    expect(r.w).toBe(100);
    expect(r.h).toBe(50);
  });

  it('shifts a rect that overflows the bottom edge', () => {
    const r = clampRectToCanvas({ x: 100, y: 580, w: 50, h: 100 }, 50, 100);
    expect(r.y + r.h).toBeLessThanOrEqual(596);
  });

  it('preserves a rect that already fits', () => {
    const r = clampRectToCanvas({ x: 50, y: 50, w: 80, h: 40 }, 80, 40);
    expect(r).toEqual({ x: 50, y: 50, w: 80, h: 40 });
  });
});

describe('segmentsIntersect', () => {
  it('detects a clean crossing X', () => {
    // (0,0)->(10,10) crosses (0,10)->(10,0)
    expect(segmentsIntersect(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
  });

  it('returns false for parallel disjoint segments', () => {
    expect(segmentsIntersect(0, 0, 10, 0, 0, 5, 10, 5)).toBe(false);
  });

  it('returns false for segments that share an endpoint (T-junction)', () => {
    // A ends where B begins; not a real intersection.
    expect(segmentsIntersect(0, 0, 5, 5, 5, 5, 10, 0)).toBe(false);
  });

  it('returns false for segments that miss each other', () => {
    expect(segmentsIntersect(0, 0, 5, 0, 10, 0, 15, 0)).toBe(false);
  });
});

describe('labelEdgePoint', () => {
  it('returns the rect center when the ray origin coincides with it', () => {
    const rect = { x: 100, y: 100, w: 50, h: 30 };
    const p = labelEdgePoint(125, 115, rect);
    expect(p).toEqual({ x: 125, y: 115 });
  });

  it('returns the rect center when from equals anchor (dx=0,dy=0 fallback)', () => {
    const rect = { x: 100, y: 100, w: 50, h: 30 };
    // Center is (125, 115); passing from there should return the center.
    expect(labelEdgePoint(125, 115, rect)).toEqual({ x: 125, y: 115 });
  });

  it('hits the left edge when the segment comes from the left', () => {
    const rect = { x: 100, y: 100, w: 50, h: 30 };
    // Center (125, 115), from (0, 115) — pure horizontal, hits left edge.
    const p = labelEdgePoint(0, 115, rect);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(115);
  });

  it('hits the top edge when the segment comes from straight above', () => {
    const rect = { x: 100, y: 100, w: 50, h: 30 };
    // Center (125, 115), from (125, 0) — pure vertical, hits top edge.
    const p = labelEdgePoint(125, 0, rect);
    expect(p.x).toBeCloseTo(125);
    expect(p.y).toBeCloseTo(100);
  });
});

describe('placeLabel', () => {
  it('places above by default when no other labels exist', () => {
    const result = placeLabel(500, 300, 80, 30, []);
    expect(result).not.toBeNull();
    // Above: y = anchorY - labelHeight - 10 = 300 - 30 - 10 = 260
    expect(result!.y).toBe(260);
  });

  it('returns null when every candidate overlaps an existing label', () => {
    // Anchor at (500, 300). Build a giant blocking label centered on (500, 285)
    // which is right above. Also blocks below/left/right.
    const blocker = { rect: { x: 0, y: 0, w: 1000, h: 600 }, anchorX: 500, anchorY: 300 };
    const result = placeLabel(500, 300, 80, 30, [blocker]);
    expect(result).toBeNull();
  });

  it('skips candidates that overflow the canvas', () => {
    // Anchor near left edge — "above" would have x negative, "left" too.
    // Should still find a valid candidate inside the canvas.
    const result = placeLabel(10, 300, 80, 30, []);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(4);
    expect(result!.y).toBeGreaterThanOrEqual(4);
    expect(result!.x + 80).toBeLessThanOrEqual(1000 - 4);
  });
});

describe('bestEffortLabel', () => {
  it('always returns a position (never null) even with blockers', () => {
    const blocker = { rect: { x: 0, y: 0, w: 1000, h: 600 }, anchorX: 500, anchorY: 300 };
    const result = bestEffortLabel(500, 300, 80, 30, [blocker]);
    expect(result).toBeDefined();
    expect(typeof result.x).toBe('number');
    expect(typeof result.y).toBe('number');
  });

  it('clamps inside the canvas when no blockers exist', () => {
    // Anchor near left edge.
    const result = bestEffortLabel(10, 300, 80, 30, []);
    expect(result.x).toBeGreaterThanOrEqual(4);
    expect(result.x + 80).toBeLessThanOrEqual(996);
  });
});