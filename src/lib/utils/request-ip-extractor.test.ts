import { describe, expect, it } from 'vitest';
import { extractClientIpAddress } from './request-ip-extractor';

function makeRequest(headers: Record<string, string | null>): {
  headers: { get(name: string): string | null };
} {
  return {
    headers: {
      get: (name: string): string | null => {
        const k = name.toLowerCase();
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === k) return headers[key];
        }
        return null;
      },
    },
  };
}

describe('extractClientIpAddress', () => {
  it('prefers x-forwarded-for when present', () => {
    const req = makeRequest({
      'x-forwarded-for': '203.0.113.1, 10.0.0.1, 10.0.0.2',
      'x-real-ip': '198.51.100.5',
    });
    expect(extractClientIpAddress(req as never)).toBe('203.0.113.1');
  });

  it('trims whitespace in x-forwarded-for entries', () => {
    const req = makeRequest({
      'x-forwarded-for': '   203.0.113.5   ,  10.0.0.1',
    });
    expect(extractClientIpAddress(req as never)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty', () => {
    const req = makeRequest({
      'x-forwarded-for': '',
      'x-real-ip': '198.51.100.5',
    });
    expect(extractClientIpAddress(req as never)).toBe('198.51.100.5');
  });

  it('falls back to x-remote-address when both above are missing', () => {
    const req = makeRequest({
      'x-remote-address': '198.51.100.7',
    });
    expect(extractClientIpAddress(req as never)).toBe('198.51.100.7');
  });

  it('returns 127.0.0.1 when no IP header is present', () => {
    const req = makeRequest({});
    expect(extractClientIpAddress(req as never)).toBe('127.0.0.1');
  });

  it('skips an empty first entry in x-forwarded-for and uses the next one', () => {
    const req = makeRequest({
      'x-forwarded-for': ',10.0.0.1',
    });
    expect(extractClientIpAddress(req as never)).toBe('10.0.0.1');
  });
});