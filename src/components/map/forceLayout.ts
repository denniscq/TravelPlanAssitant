// Force-directed layout for the simplified route diagram.
//
// Replaces the previous sequential bearing-based layout, which produced three
// user-visible defects:
//   1. numbered badges drifted into blank space
//   2. in-line text rotated at arbitrary angles
//   3. segments visually disconnected at intermediate POIs
//
// The new layout treats the route as a force graph: each node experiences
// spring, repulsion, and centering forces. Start and end nodes are pinned to
// fixed canvas positions (left third / right third) so the journey endpoints
// are immediately visible. The simulation is fully deterministic — identical
// input always produces identical output.

export interface LayoutNode {
  id: string;
  /** Initial x position (pixels). Ignored for fixed nodes when `fixed === true`. */
  x: number;
  /** Initial y position (pixels). Ignored for fixed nodes when `fixed === true`. */
  y: number;
  /** When true, the node's position is restored to (x, y) every iteration. */
  fixed: boolean;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  /**
   * Desired edge length in pixels. Defaults to 180 px when omitted.
   * Pass scaled values (e.g. proportional to real geographic distance) to
   * preserve "near vs. far" relationships in the final diagram.
   */
  idealLength?: number;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Number of simulation iterations. Defaults to 300. */
  iterations?: number;
  /** Minimum pixel spacing between any two non-fixed nodes. Defaults to 100. */
  minSpacing?: number;
  /** Maximum ±px wobble applied per node using a deterministic id hash. Defaults to 2. */
  wobbleAmplitude?: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  nodes: LayoutNode[];
}

const DEFAULT_ITERATIONS = 300;
const DEFAULT_MIN_SPACING = 100;
const DEFAULT_WOBBLE_AMPLITUDE = 2;
const DEFAULT_EDGE_LENGTH = 180;
const INITIAL_STEP = 8;
const FINAL_STEP = 0.1;
const CANVAS_MARGIN = 30;
// Repulsion force scale. Higher = nodes push each other harder.
const REPULSION_K = 8000;
// Centering force scale. Higher = nodes pulled toward canvas center more.
const CENTERING_K = 0.02;
// Spring stiffness. Higher = edges snap to ideal length faster.
const SPRING_K = 0.08;
// Inner margin (pixels) between the pinned anchors and the canvas edge.
const ANCHOR_MARGIN_X = 80;

/**
 * Tiny deterministic 32-bit string hash (FNV-1a). Identical input → identical output.
 * Used to seed wobble and any other randomness so the layout is byte-stable.
 */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic wobble offset for a node. Returns a value in [-1, 1].
 */
function wobbleUnit(seed: number): number {
  // Use the lower bits of the hash; normalize to [-1, 1].
  return ((seed % 2000) - 1000) / 1000;
}

interface InternalNode extends LayoutNode {
  vx: number;
  vy: number;
  pinnedX: number;
  pinnedY: number;
  hashSeed: number;
}

function toInternal(nodes: LayoutNode[]): InternalNode[] {
  return nodes.map((n) => ({
    ...n,
    vx: 0,
    vy: 0,
    pinnedX: n.x,
    pinnedY: n.y,
    hashSeed: hashString(n.id),
  }));
}

function applySpringForce(
  a: InternalNode,
  b: InternalNode,
  ideal: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const displacement = dist - ideal;
  const fx = (dx / dist) * displacement * SPRING_K;
  const fy = (dy / dist) * displacement * SPRING_K;
  if (!a.fixed) {
    a.vx += fx;
    a.vy += fy;
  }
  if (!b.fixed) {
    b.vx -= fx;
    b.vy -= fy;
  }
}

function applyRepulsionForce(
  a: InternalNode,
  b: InternalNode,
  minSpacing: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist2 = dx * dx + dy * dy;
  if (dist2 < 0.0001) return;
  const dist = Math.sqrt(dist2);
  const target = Math.max(dist, minSpacing);
  const magnitude = REPULSION_K / (target * target);
  const fx = (dx / dist) * magnitude;
  const fy = (dy / dist) * magnitude;
  if (!a.fixed) {
    a.vx -= fx;
    a.vy -= fy;
  }
  if (!b.fixed) {
    b.vx += fx;
    b.vy += fy;
  }
}

function applyCenteringForce(
  a: InternalNode,
  cx: number,
  cy: number,
): void {
  if (a.fixed) return;
  a.vx += (cx - a.x) * CENTERING_K;
  a.vy += (cy - a.y) * CENTERING_K;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizePositions(
  nodes: InternalNode[],
  width: number,
  height: number,
): void {
  // Find the bounding box of FREE nodes only — fixed nodes stay where they are.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.fixed) continue;
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  if (!isFinite(minX)) return; // No free nodes — nothing to scale.

  const freeW = Math.max(maxX - minX, 1);
  const freeH = Math.max(maxY - minY, 1);
  const targetW = width - 2 * CANVAS_MARGIN;
  const targetH = height - 2 * CANVAS_MARGIN;
  const scale = Math.min(targetW / freeW, targetH / freeH);

  const offsetX = CANVAS_MARGIN + (targetW - freeW * scale) / 2 - minX * scale;
  const offsetY = CANVAS_MARGIN + (targetH - freeH * scale) / 2 - minY * scale;

  for (const n of nodes) {
    if (n.fixed) continue;
    n.x = clamp(n.x * scale + offsetX, CANVAS_MARGIN, width - CANVAS_MARGIN);
    n.y = clamp(n.y * scale + offsetY, CANVAS_MARGIN, height - CANVAS_MARGIN);
  }
}

function reapplyPinned(nodes: InternalNode[]): void {
  for (const n of nodes) {
    if (!n.fixed) continue;
    n.x = n.pinnedX;
    n.y = n.pinnedY;
    n.vx = 0;
    n.vy = 0;
  }
}

function finalize(
  nodes: InternalNode[],
  width: number,
  height: number,
  wobbleAmplitude: number,
): LayoutNode[] {
  // Re-pin fixed nodes to canonical left-third / right-third positions, so
  // users see a stable "start on left, end on right" layout regardless of
  // where the caller passed the original coordinates.
  const start = nodes.find((n) => n.fixed && n.pinnedX <= width / 2);
  const end = nodes.find((n) => n.fixed && n.pinnedX > width / 2);
  if (start) {
    start.x = width / 3;
    start.y = height / 2;
  }
  if (end) {
    end.x = (width * 2) / 3;
    end.y = height / 2;
  }

  return nodes.map((n) => {
    const out: LayoutNode = { id: n.id, x: n.x, y: n.y, fixed: n.fixed };
    if (n.fixed || wobbleAmplitude === 0) return out;
    out.x += wobbleUnit(n.hashSeed) * wobbleAmplitude;
    out.y += wobbleUnit(n.hashSeed ^ 0xdeadbeef) * wobbleAmplitude;
    return out;
  });
}

export function computeForceLayout(
  input: LayoutInput,
  options: LayoutOptions,
): LayoutResult {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const minSpacing = options.minSpacing ?? DEFAULT_MIN_SPACING;
  const wobbleAmplitude = options.wobbleAmplitude ?? DEFAULT_WOBBLE_AMPLITUDE;

  const nodes = toInternal(input.nodes);
  const nodeById = new Map<string, InternalNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  const edges = input.edges
    .map((e) => ({
      a: nodeById.get(e.fromId),
      b: nodeById.get(e.toId),
      ideal: e.idealLength ?? DEFAULT_EDGE_LENGTH,
    }))
    .filter((e): e is { a: InternalNode; b: InternalNode; ideal: number } =>
      e.a !== undefined && e.b !== undefined && e.a !== e.b
    );

  if (nodes.length === 0) {
    return { width: options.width, height: options.height, nodes: [] };
  }

  const cx = options.width / 2;
  const cy = options.height / 2;

  for (let iter = 0; iter < iterations; iter++) {
    // Reset velocities each iteration (we are not simulating inertia).
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }

    // Spring forces along edges.
    for (const e of edges) {
      applySpringForce(e.a, e.b, e.ideal);
    }

    // Repulsion between every pair.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        applyRepulsionForce(nodes[i], nodes[j], minSpacing);
      }
    }

    // Centering.
    for (const n of nodes) applyCenteringForce(n, cx, cy);

    // Apply displacement with linear cooling.
    const t = iterations === 1 ? 1 : iter / (iterations - 1);
    const step = INITIAL_STEP + (FINAL_STEP - INITIAL_STEP) * t;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.x += n.vx * step;
      n.y += n.vy * step;
    }

    reapplyPinned(nodes);
  }

  // Skip normalize + reapplyPinned when no iterations ran — the caller
  // passed us the final positions directly and doesn't want them shifted.
  if (iterations > 0) {
    normalizePositions(nodes, options.width, options.height);
    reapplyPinned(nodes);
  }

  return {
    width: options.width,
    height: options.height,
    nodes: finalize(nodes, options.width, options.height, wobbleAmplitude),
  };
}
