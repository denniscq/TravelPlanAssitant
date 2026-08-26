import { getRoutePlanQueueMaxLength } from '../utils/environment';

/**
 * Thrown by `RoutePlanQueue.enqueue` when the waiting queue has
 * already reached its configured limit and no further requests
 * can be accepted.
 */
export class QueueFullError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

interface QueueTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * In-process FIFO request queue.
 *
 * Enforces serial execution: even though multiple work items may
 * be enqueued, at most one is "active" at any moment. When the
 * active item settles (success or failure), the next waiting item
 * is dispatched in the next microtask. This guarantees that two
 * expensive upstream calls (LLM + AMap) never overlap, which is
 * the contract the route-plan endpoint needs to stay within
 * third-party QPS limits.
 *
 * Upper bound: at most `maxLength` items may sit in the waiting
 * array. New enqueues beyond that limit reject immediately with
 * `QueueFullError`, so the caller can return HTTP 429 without
 * holding a queue slot and without unbounded memory growth.
 */
export class RoutePlanQueue {
  private readonly waiting: QueueTask[] = [];
  private activeCount = 0;
  private readonly maxLength: number;

  public constructor(maxLength: number) {
    if (!Number.isFinite(maxLength) || maxLength < 1) {
      throw new Error(
        `RoutePlanQueue maxLength must be a positive integer, got ${maxLength}`,
      );
    }
    this.maxLength = Math.floor(maxLength);
  }

  /**
   * Submit a unit of work. Returns a Promise that resolves or
   * rejects with the same outcome as `work`. If the waiting queue
   * is already at capacity, the returned Promise rejects
   * immediately with `QueueFullError` so the caller can fail fast
   * (typically returning HTTP 429).
   */
  public enqueue<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.waiting.length >= this.maxLength) {
        reject(
          new QueueFullError(
            `RoutePlanQueue is full (${this.waiting.length}/${this.maxLength})`,
          ),
        );
        return;
      }
      this.waiting.push({
        run: work as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  /**
   * Snapshot of the current queue state, useful for diagnostics
   * and tests. Returned object is plain so it's safe to log.
   */
  public getStats(): {
    active: number;
    waiting: number;
    maxLength: number;
  } {
    return {
      active: this.activeCount,
      waiting: this.waiting.length,
      maxLength: this.maxLength,
    };
  }

  /**
   * Try to dispatch the next waiting task, if any. No-op when
   * a task is already active or the queue is empty. Always called
   * after `enqueue` and after each task settles so the next task
   * makes progress regardless of the previous task's outcome.
   */
  private drain(): void {
    if (this.activeCount > 0 || this.waiting.length === 0) {
      return;
    }
    const task = this.waiting.shift();
    if (task === undefined) {
      return;
    }
    this.activeCount++;
    // Promise.resolve() guarantees `run` is invoked on a microtask,
    // not synchronously. This lets the calling stack unwind before
    // we mutate `activeCount`, and matches the contract that
    // `enqueue` returns synchronously without blocking.
    Promise.resolve()
      .then(() => task.run())
      .then(
        (value) => {
          this.activeCount--;
          task.resolve(value);
          this.drain();
        },
        (reason: unknown) => {
          this.activeCount--;
          task.reject(reason);
          this.drain();
        },
      );
  }
}

/**
 * Module-level singleton queue, instantiated once at module load
 * with the configured upper bound. The route handler imports this
 * directly so the limit is consistent across requests.
 */
export const routePlanQueue = new RoutePlanQueue(getRoutePlanQueueMaxLength());