import { describe, it, expect } from 'vitest';
import { RoutePlanQueue, QueueFullError } from './RoutePlanQueue';

describe('RoutePlanQueue', () => {
  it('executes first enqueue immediately', async () => {
    const q = new RoutePlanQueue(5);
    const order: string[] = [];
    await q.enqueue(async () => {
      order.push('first');
    });
    expect(order).toEqual(['first']);
    expect(q.getStats()).toEqual({ active: 0, waiting: 0, maxLength: 5 });
  });

  it('returns Promise synchronously without blocking the caller', async () => {
    const q = new RoutePlanQueue(5);
    const slow = (): Promise<void> => new Promise((r) => setTimeout(r, 100));
    const p = q.enqueue(slow);
    // Immediately after enqueue, the task should already be active
    // (microtask scheduled before this synchronous check).
    expect(q.getStats().active).toBe(1);
    await p;
  });

  it('queues second task behind first', async () => {
    const q = new RoutePlanQueue(5);
    const order: string[] = [];
    const p1 = q.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('first');
    });
    expect(q.getStats().active).toBe(1);
    const p2 = q.enqueue(async () => {
      order.push('second');
    });
    expect(q.getStats().waiting).toBe(1);
    await Promise.all([p1, p2]);
    expect(order).toEqual(['first', 'second']);
  });

  it('propagates task errors to the caller', async () => {
    const q = new RoutePlanQueue(5);
    await expect(
      q.enqueue(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('continues draining after a task error', async () => {
    const q = new RoutePlanQueue(5);
    const order: string[] = [];
    const p1 = q.enqueue(async () => {
      throw new Error('boom');
    });
    const p2 = q.enqueue(async () => {
      order.push('second');
    });
    await expect(p1).rejects.toThrow('boom');
    await p2;
    expect(order).toEqual(['second']);
    expect(q.getStats().active).toBe(0);
  });

  it('rejects when waiting queue is full', async () => {
    const q = new RoutePlanQueue(2);
    const slow = (): Promise<void> => new Promise((r) => setTimeout(r, 100));
    // 1 active, 2 waiting
    q.enqueue(slow);
    q.enqueue(slow);
    q.enqueue(slow);
    // Now waiting.length === 2 (== maxLength); the 4th should be rejected
    await expect(q.enqueue(slow)).rejects.toBeInstanceOf(QueueFullError);
  });

  it('reports accurate stats over the queue lifecycle', async () => {
    const q = new RoutePlanQueue(5);
    const slow = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
    q.enqueue(slow);
    q.enqueue(slow);
    expect(q.getStats()).toEqual({ active: 1, waiting: 1, maxLength: 5 });
    // wait long enough for first to settle, second to start
    await new Promise((r) => setTimeout(r, 50));
    expect(q.getStats().active).toBe(1);
    expect(q.getStats().waiting).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(q.getStats()).toEqual({ active: 0, waiting: 0, maxLength: 5 });
  });

  it('only the first N+1 succeed when many concurrent enqueues arrive', async () => {
    // maxLength caps waiting.length, not waiting+active. So with
    // maxLength=3, up to 4 requests can coexist (1 active + 3
    // waiting). Anything beyond the 4th enqueue is rejected.
    const q = new RoutePlanQueue(3);
    const slow = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
    const results: string[] = [];
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 6; i++) {
      const idx = i;
      promises.push(
        q.enqueue(slow).then(
          () => {
            results.push(`ok${idx}`);
          },
          (e: unknown) => {
            if (e instanceof QueueFullError) {
              results.push(`full${idx}`);
            } else {
              results.push(`err${idx}`);
            }
          },
        ),
      );
    }
    await Promise.all(promises);
    // 1 active + 3 waiting = 4 successes; 5-6 rejected as full
    expect(results.filter((r) => r.startsWith('ok')).length).toBe(4);
    expect(results.filter((r) => r.startsWith('full')).length).toBe(2);
  });
});