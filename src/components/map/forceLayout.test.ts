import { describe, it, expect } from 'vitest';
import { computeForceLayout, type LayoutNode, type LayoutEdge } from './forceLayout';

function fixed(x: number, y: number): LayoutNode {
  return { id: 'fixed-' + x + '-' + y, x, y, fixed: true };
}

function free(id: string): LayoutNode {
  return { id, x: 0, y: 0, fixed: false };
}

const CANVAS = { width: 1000, height: 550 };

describe('computeForceLayout', () => {
  describe('determinism', () => {
    it('returns identical positions for identical input', () => {
      const nodes: LayoutNode[] = [
        fixed(200, 275),
        free('a'),
        free('b'),
        free('c'),
        fixed(800, 275),
      ];
      const edges: LayoutEdge[] = [
        { fromId: 'fixed-200-275', toId: 'a' },
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'c' },
        { fromId: 'c', toId: 'fixed-800-275' },
      ];

      const r1 = computeForceLayout({ nodes, edges }, CANVAS);
      const r2 = computeForceLayout({ nodes, edges }, CANVAS);

      expect(r2.nodes).toEqual(r1.nodes);
    });
  });

  describe('pinned anchors', () => {
    it('keeps start node on the left third and end node on the right third', () => {
      const nodes: LayoutNode[] = [
        fixed(200, 275),
        free('a'),
        free('b'),
        fixed(800, 275),
      ];
      const edges: LayoutEdge[] = [
        { fromId: 'fixed-200-275', toId: 'a' },
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'fixed-800-275' },
      ];

      const { nodes: out } = computeForceLayout({ nodes, edges }, CANVAS);
      const start = out.find((n) => n.id === 'fixed-200-275');
      const end = out.find((n) => n.id === 'fixed-800-275');

      // After normalization, fixed nodes should be re-pinned to left/right thirds.
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      expect(start!.x).toBeLessThan(CANVAS.width / 3 + 50);
      expect(start!.x).toBeGreaterThan(CANVAS.width / 3 - 50);
      expect(end!.x).toBeGreaterThan((CANVAS.width * 2) / 3 - 50);
      expect(end!.x).toBeLessThan((CANVAS.width * 2) / 3 + 50);
    });
  });

  describe('minimum spacing', () => {
    it('keeps all nodes at least 100 px apart (except fixed nodes by design)', () => {
      // When two fixed nodes are far apart, free nodes between them must not
      // overlap each other or come within 100 px.
      const nodes: LayoutNode[] = [
        fixed(200, 275),
        free('a'),
        free('b'),
        free('c'),
        free('d'),
        fixed(800, 275),
      ];
      const edges: LayoutEdge[] = [
        { fromId: 'fixed-200-275', toId: 'a' },
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'c' },
        { fromId: 'c', toId: 'd' },
        { fromId: 'd', toId: 'fixed-800-275' },
      ];

      const { nodes: out } = computeForceLayout({ nodes, edges }, CANVAS);
      const freeOut = out.filter((n) => !n.fixed);

      for (let i = 0; i < freeOut.length; i++) {
        for (let j = i + 1; j < freeOut.length; j++) {
          const dx = freeOut[i].x - freeOut[j].x;
          const dy = freeOut[i].y - freeOut[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          expect(dist).toBeGreaterThanOrEqual(95); // tolerance for wobble
        }
      }
    });
  });

  describe('distance ordering', () => {
    it('preserves geographic nearness: close pair stays visually closer than far pair', () => {
      // A and B are "geographically close" (ideal length 100).
      // A and C are "geographically far" (ideal length 400).
      // After layout, A-B visual distance should be < A-C visual distance.
      const nodes: LayoutNode[] = [
        fixed(200, 275),
        free('A'),
        free('B'),
        free('C'),
        fixed(800, 275),
      ];
      const edges: LayoutEdge[] = [
        { fromId: 'fixed-200-275', toId: 'A', idealLength: 200 },
        { fromId: 'A', toId: 'B', idealLength: 100 },
        { fromId: 'B', toId: 'C', idealLength: 400 },
        { fromId: 'C', toId: 'fixed-800-275', idealLength: 200 },
      ];

      const { nodes: out } = computeForceLayout({ nodes, edges }, CANVAS);
      const a = out.find((n) => n.id === 'A')!;
      const b = out.find((n) => n.id === 'B')!;
      const c = out.find((n) => n.id === 'C')!;

      const dAB = Math.hypot(a.x - b.x, a.y - b.y);
      const dAC = Math.hypot(a.x - c.x, a.y - c.y);

      expect(dAB).toBeLessThan(dAC);
    });
  });

  describe('edge cases', () => {
    it('handles empty node list without throwing', () => {
      const result = computeForceLayout({ nodes: [], edges: [] }, CANVAS);
      expect(result.nodes).toEqual([]);
    });

    it('handles single node without throwing', () => {
      const result = computeForceLayout(
        { nodes: [free('lonely')], edges: [] },
        CANVAS
      );
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('lonely');
    });

    it('handles only start and end without throwing', () => {
      const result = computeForceLayout(
        {
          nodes: [fixed(200, 275), fixed(800, 275)],
          edges: [],
        },
        CANVAS
      );
      expect(result.nodes).toHaveLength(2);
    });
  });
});
