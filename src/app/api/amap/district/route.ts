import { NextRequest, NextResponse } from 'next/server';
import { getAmapApiKey } from '../../../../lib/utils/environment';
import { AmapDistrictResponse, AmapDistrictItem } from '../../../../lib/types/amap-service-types';
import { createServerLogger } from '../../../../lib/utils/server-logger';

interface DistrictTreeNode {
  label: string;
  value: string;
  adcode: string;
  center: [number, number];
  children?: DistrictTreeNode[];
}

function mapToTreeNode(item: AmapDistrictItem): DistrictTreeNode {
  const [lng, lat] = item.center.split(',').map(Number);
  const node: DistrictTreeNode = {
    label: item.name,
    value: item.name,
    adcode: item.adcode,
    center: [lng, lat],
  };

  if (item.districts.length > 0) {
    node.children = item.districts.map(mapToTreeNode);
  }

  return node;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const logger = createServerLogger(request);

  try {
    const { searchParams } = new URL(request.url);
    const adcode = searchParams.get('adcode') ?? '';

    const params = new URLSearchParams({
      key: getAmapApiKey(),
      keywords: adcode,
      subdistrict: '3',
      showbiz: 'false',
      extensions: 'base',
    });

    const url = `https://restapi.amap.com/v3/config/district?${params.toString()}`;
    const response = await fetch(url);
    const data: AmapDistrictResponse = await response.json();

    if (data.status !== '1' || data.districts.length === 0) {
      logger.warn('District query failed - ' + data.info);
      return NextResponse.json({ success: false, error: 'Failed to load districts.' }, { status: 400 });
    }

    const tree = data.districts.map(mapToTreeNode);

    // Filter out the country level — only keep provinces
    const filtered: DistrictTreeNode[] = [];
    for (const node of tree) {
      // AMap returns "中华人民共和国" as the root; skip it and use its children
      if (node.children && node.children.length > 0 && (node.label === '中华人民共和国' || node.label === '中国')) {
        filtered.push(...node.children);
      } else {
        filtered.push(node);
      }
    }

    logger.info('District tree loaded - root=' + filtered.length + ' provinces');
    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    logger.error('District query error - ' + String(error));
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}