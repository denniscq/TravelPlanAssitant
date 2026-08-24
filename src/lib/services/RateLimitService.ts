import { RateLimiterMemory } from 'rate-limiter-flexible';
import { getRateLimitMax, getRateLimitWindowMs } from '../utils/environment';

interface RateLimitCheckResult {
  isAllowed: boolean;
  remainingPoints: number;
  retryAfterSeconds: number;
}

export class RateLimitService {
  private rateLimiter: RateLimiterMemory;

  public constructor() {
    const maxPoints = getRateLimitMax();
    const windowDurationMs = getRateLimitWindowMs();

    this.rateLimiter = new RateLimiterMemory({
      points: maxPoints,
      duration: Math.ceil(windowDurationMs / 1000),
    });
  }

  public async checkRateLimit(clientIp: string): Promise<RateLimitCheckResult> {
    try {
      const rateLimitResult = await this.rateLimiter.consume(clientIp, 1);

      return {
        isAllowed: true,
        remainingPoints: rateLimitResult.remainingPoints,
        retryAfterSeconds: 0,
      };
    } catch (rateLimitError) {
      if (rateLimitError instanceof Error === false && typeof rateLimitError === 'object' && rateLimitError !== null) {
        const error = rateLimitError as { msBeforeNext?: number; remainingPoints?: number };
        const retryAfterSeconds = Math.ceil((error.msBeforeNext ?? 3600000) / 1000);

        return {
          isAllowed: false,
          remainingPoints: error.remainingPoints ?? 0,
          retryAfterSeconds,
        };
      }

      console.error('Unexpected rate limiter error:', rateLimitError);
      return {
        isAllowed: false,
        remainingPoints: 0,
        retryAfterSeconds: 3600,
      };
    }
  }

  public async resetRateLimit(clientIp: string): Promise<void> {
    await this.rateLimiter.delete(clientIp);
  }
}

export const rateLimitService = new RateLimitService();