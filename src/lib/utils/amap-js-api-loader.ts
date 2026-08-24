import { getAmapJsApiKey, getAmapJsApiSecret } from './environment';

let amapPromise: Promise<typeof AMap> | null = null;

export async function loadAmapJsApi(plugins?: string[]): Promise<typeof AMap> {
  if (amapPromise !== null) {
    return amapPromise;
  }

  // Dynamic import to avoid bundling @amap/amap-jsapi-loader at build time
  const AMapLoader = (await import('@amap/amap-jsapi-loader')).default;

  const loadOptions: Record<string, unknown> = {
    key: getAmapJsApiKey(),
    version: '2.0',
    securityJsCode: getAmapJsApiSecret(),
  };

  // Add plugins if specified
  if (plugins !== undefined && plugins.length > 0) {
    loadOptions.plugins = plugins;
  }

  amapPromise = AMapLoader.load(loadOptions as { key: string; version: string; plugins?: string[] }) as Promise<typeof AMap>;

  return amapPromise;
}

export function resetAmapLoader(): void {
  amapPromise = null;
}

/**
 * Detect the user's current city using AMap's Geolocation plugin.
 * This is the most reliable method for Chinese users — works on localhost,
 * uses the browser's geolocation API + IP fallback, and is not blocked by the GFW.
 * Returns the city name, adcode, and center coordinates, or null on failure.
 */
export interface DetectedCity {
  name: string;
  adcode: string;
  center: [number, number];
}

export async function detectCurrentCity(): Promise<DetectedCity | null> {
  try {
    const AMap = await loadAmapJsApi(['AMap.Geolocation']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Geolocation = (AMap as any).Geolocation as new (opts: Record<string, unknown>) => {
      getCityInfo(cb: (status: string, result: Record<string, unknown>) => void): void;
    };

    const geolocation = new Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
      zoomToAccuracy: true,
    });

    const result = await new Promise<{ position: { lng: number; lat: number }; city: string; adcode: string }>(
      (resolve, reject) => {
        geolocation.getCityInfo((status: string, result: Record<string, unknown>) => {
          if (status === 'complete') {
            resolve(result as unknown as { position: { lng: number; lat: number }; city: string; adcode: string });
          } else {
            reject(new Error(String(result.message ?? 'Geolocation failed')));
          }
        });
      }
    );

    if (result.city !== '' && result.city !== undefined) {
      return {
        name: result.city,
        adcode: result.adcode,
        center: [result.position.lng, result.position.lat],
      };
    }

    return null;
  } catch (error) {
    console.warn('City detection via AMap Geolocation failed, will use IP fallback:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}