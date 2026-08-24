import { NextRequest } from 'next/server';

export function extractClientIpAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor !== null) {
    const ipAddresses = forwardedFor.split(',');
    const firstIp = ipAddresses[0].trim();
    if (firstIp.length > 0) {
      return firstIp;
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