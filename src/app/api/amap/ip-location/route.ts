import { NextRequest, NextResponse } from 'next/server';
import { getAmapApiKey } from '../../../../lib/utils/environment';
import { AmapIpLocationResponse } from '../../../../lib/types/amap-service-types';
import { createServerLogger } from '../../../../lib/utils/server-logger';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? '';

    const params = new URLSearchParams({
      key: getAmapApiKey(),
      output: 'JSON',
    });

    // Only add ip param if it's a non-empty, non-localhost IP
    if (ip !== '' && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1' && !ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('172.16.')) {
      params.set('ip', ip);
    }

    const url = `https://restapi.amap.com/v3/ip?${params.toString()}`;
    logger.info('IP location request - ip=' + (params.has('ip') ? params.get('ip')! : '(not provided, AMap will auto-detect)'));
    const response = await fetch(url);
    const data: AmapIpLocationResponse = await response.json();

    if (data.status !== '1') {
      logger.warn('IP location lookup failed - ' + data.info);
      return NextResponse.json({
        success: true,
        data: { province: '', city: '', adcode: '' },
      });
    }

    logger.info('IP location resolved - province=' + data.province + ', city=' + data.city);
    return NextResponse.json({
      success: true,
      data: {
        province: data.province,
        city: data.city,
        adcode: data.adcode,
      },
    });
  } catch (error) {
    logger.error('IP location lookup error - ' + String(error));
    return NextResponse.json({
      success: true,
      data: { province: '', city: '', adcode: '' },
    });
  }
}