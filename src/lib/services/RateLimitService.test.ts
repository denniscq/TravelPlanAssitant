import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitService } from './RateLimitService';

describe('RateLimitService', () => {
  const originalMax = process.env.LLM_SERVICE_RATE_LIMIT_MAX;
  const originalWindow = process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS;

  beforeEach(() => {
    // Tight window so the test runs in milliseconds, not the default 1 hour.
    process.env.LLM_SERVICE_RATE_LIMIT_MAX = '3';
    process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterEach(() => {
    if (originalMax === undefined) delete process.env.LLM_SERVICE_RATE_LIMIT_MAX;
    else process.env.LLM_SERVICE_RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS;
    else process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('allows requests up to the configured maximum', async () => {
    const service = new RateLimitService();
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await service.checkRateLimit('1.1.1.1'));
    }
    expect(results.every((r) => r.isAllowed)).toBe(true);
  });

  it('rejects requests that exceed the maximum', async () => {
    const service = new RateLimitService();
    for (let i = 0; i < 3; i++) {
      await service.checkRateLimit('2.2.2.2');
    }
    const overLimit = await service.checkRateLimit('2.2.2.2');
    expect(overLimit.isAllowed).toBe(false);
    expect(overLimit.retryAfterSeconds).toBeGreaterThan(0);
    expect(overLimit.remainingPoints).toBe(0);
  });

  it('tracks quota per IP independently', async () => {
    const service = new RateLimitService();
    // Exhaust IP A.
    for (let i = 0; i < 3; i++) await service.checkRateLimit('3.3.3.3');
    // IP B is fresh.
    const b = await service.checkRateLimit('4.4.4.4');
    expect(b.isAllowed).toBe(true);
  });

  it('resetRateLimit restores quota', async () => {
    const service = new RateLimitService();
    for (let i = 0; i < 3; i++) await service.checkRateLimit('5.5.5.5');
    const blocked = await service.checkRateLimit('5.5.5.5');
    expect(blocked.isAllowed).toBe(false);

    await service.resetRateLimit('5.5.5.5');
    const afterReset = await service.checkRateLimit('5.5.5.5');
    expect(afterReset.isAllowed).toBe(true);
  });

  it('reports decreasing remainingPoints across successful calls', async () => {
    const service = new RateLimitService();
    const r1 = await service.checkRateLimit('6.6.6.6');
    const r2 = await service.checkRateLimit('6.6.6.6');
    const r3 = await service.checkRateLimit('6.6.6.6');
    expect(r1.remainingPoints).toBeGreaterThan(r2.remainingPoints);
    expect(r2.remainingPoints).toBeGreaterThan(r3.remainingPoints);
  });
});