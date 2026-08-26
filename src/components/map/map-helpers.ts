/**
 * Pure helpers used by SimplifiedMap rendering. Extracted into a
 * separate file (instead of being inlined in the React component) so
 * they can be unit-tested without spinning up a React renderer.
 */

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;

/**
 * Format a distance in meters as a human-readable Chinese string.
 * Examples:
 *   formatDistance(450)   -> "450 米"
 *   formatDistance(1500)  -> "1.5 公里"
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return (meters / 1000).toFixed(1) + ' 公里';
  return Math.round(meters) + ' 米';
}

/**
 * Format a duration in seconds as a human-readable Chinese string.
 * Examples:
 *   formatDuration(45)    -> "1 分钟"
 *   formatDuration(3600)  -> "1 小时 0 分钟"
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h + ' 小时 ' + m + ' 分钟';
  }
  return minutes + ' 分钟';
}

/**
 * Deterministic FNV-style hash of a string into the [-1, 1] range.
 * Used to give every label a stable but pseudo-random tilt for the
 * hand-drawn look. Same id -> same tilt on every render.
 */
export function deterministicTilt(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // `h % 200` can be negative in JavaScript; coerce to [0, 200) first
  // so the tilt stays in [-1, 1] as the function comment promises.
  const mod = ((h % 200) + 200) % 200;
  return (mod - 100) / 100;
}

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Axis-aligned bounding-box overlap test. Touching edges do NOT count
 * as overlap (strict inequalities) so labels that share a border don't
 * trigger spurious collisions.
 */
export function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return !(
    a.x + a.w <= b.x ||
    a.x >= b.x + b.w ||
    a.y + a.h <= b.y ||
    a.y >= b.y + b.h
  );
}

/**
 * Clamp a value into [lo, hi].
 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Test whether two line segments AB and CD intersect strictly inside
 * both segments. Endpoint touches are NOT counted as intersection —
 * that happens for every pair of consecutive segments sharing a POI
 * and we don't want to flag those.
 *
 * Standard orientation test with strict inequalities on the sign
 * comparison.
 */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const r1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const r2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const r3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const r4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((r1 > 0) !== (r2 > 0)) && ((r3 > 0) !== (r4 > 0));
}

/**
 * Compute where a ray (from outside → anchor) crosses a label rect's
 * border. Used by the renderer so segments connect to the side of the
 * label facing the rest of the route, instead of poking into the middle.
 *
 * `fromX/fromY` is the *other* endpoint of the segment.
 * `anchorX/anchorY` is the actual POI position (typically the rect centre).
 */
export function labelEdgePoint(
  fromX: number,
  fromY: number,
  rect: LabelRect,
): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = cx - fromX;
  const dy = cy - fromY;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { x: cx, y: cy };
  }
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const tx = Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx - dx * t, y: cy - dy * t };
}

/**
 * Clamp a label rectangle so it stays fully inside the canvas with a
 * 4 px gutter on every side.
 */
export function clampRectToCanvas(rect: LabelRect, w: number, h: number): LabelRect {
  return {
    x: clamp(rect.x, 4, CANVAS_WIDTH - w - 4),
    y: clamp(rect.y, 4, CANVAS_HEIGHT - h - 4),
    w,
    h,
  };
}

export interface PlacedLabel {
  rect: LabelRect;
  anchorX: number;
  anchorY: number;
}

/**
 * Try to place a label centered around an anchor point. Returns the
 * placed position or null if every candidate overlaps an already-placed
 * label. The anchor sits in the visual center of the label; we test 4
 * candidate positions (above, below, left, right) and pick the first
 * non-overlapping one.
 */
export function placeLabel(
  anchorX: number,
  anchorY: number,
  labelWidth: number,
  labelHeight: number,
  placed: PlacedLabel[],
): { x: number; y: number } | null {
  const candidates: { x: number; y: number }[] = [
    { x: anchorX - labelWidth / 2, y: anchorY - labelHeight - 10 },
    { x: anchorX - labelWidth / 2, y: anchorY + 10 },
    { x: anchorX - labelWidth - 10, y: anchorY - labelHeight / 2 },
    { x: anchorX + 10, y: anchorY - labelHeight / 2 },
  ];

  for (const c of candidates) {
    const x = c.x;
    const y = c.y;
    if (x < 4 || y < 4 || x + labelWidth > CANVAS_WIDTH - 4 || y + labelHeight > CANVAS_HEIGHT - 4) {
      continue;
    }
    const rect: LabelRect = { x, y, w: labelWidth, h: labelHeight };
    const overlaps = placed.some((p) => rectsOverlap(rect, p.rect));
    if (!overlaps) {
      return { x, y };
    }
  }
  return null;
}

/**
 * Fallback label placement when no clean spot is available. Picks the
 * candidate with the smallest overlap against already-placed labels
 * (clamped inside the canvas). Used as a guaranteed "no labels dropped"
 * backstop.
 */
export function bestEffortLabel(
  anchorX: number,
  anchorY: number,
  labelWidth: number,
  labelHeight: number,
  placed: PlacedLabel[],
): { x: number; y: number } {
  const candidates: { x: number; y: number }[] = [
    { x: anchorX - labelWidth / 2, y: anchorY - labelHeight - 10 },
    { x: anchorX - labelWidth / 2, y: anchorY + 10 },
    { x: anchorX - labelWidth - 10, y: anchorY - labelHeight / 2 },
    { x: anchorX + 10, y: anchorY - labelHeight / 2 },
  ];
  let best: { x: number; y: number } = candidates[0];
  let bestOverlap = Infinity;
  for (const c of candidates) {
    const rect: LabelRect = {
      x: clamp(c.x, 4, CANVAS_WIDTH - 4 - labelWidth),
      y: clamp(c.y, 4, CANVAS_HEIGHT - 4 - labelHeight),
      w: labelWidth,
      h: labelHeight,
    };
    let overlap = 0;
    for (const p of placed) {
      const ix1 = Math.max(rect.x, p.rect.x);
      const iy1 = Math.max(rect.y, p.rect.y);
      const ix2 = Math.min(rect.x + rect.w, p.rect.x + p.rect.w);
      const iy2 = Math.min(rect.y + rect.h, p.rect.y + p.rect.h);
      if (ix2 > ix1 && iy2 > iy1) overlap += (ix2 - ix1) * (iy2 - iy1);
    }
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = { x: rect.x, y: rect.y };
    }
  }
  return best;
}