import { NextRequest } from 'next/server';

export function extractClientIpAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor !== null) {
    const ipAddresses = forwardedFor.split(',');
    // Pick the first non-empty entry — comma-leading values like
    // ",10.0.0.1" would otherwise yield an empty string and silently
    // drop through to the fallback headers.
    for (const candidate of ipAddresses) {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp !== null && realIp.length > 0) {
    return realIp;
  }

  const remoteAddress = request.headers.get('x-remote-address');
  if (remoteAddress !== null && remoteAddress.length > 0) {
    return remoteAddress;
  }

  return '127.0.0.1';
}