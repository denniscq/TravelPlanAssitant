export class EnvironmentVariableError extends Error {
  public constructor(variableName: string) {
    super(`Required environment variable "${variableName}" is not set`);
    this.name = 'EnvironmentVariableError';
  }
}

export function getRequiredEnvironmentVariable(variableName: string): string {
  const value = process.env[variableName];
  if (value === undefined || value === '') {
    throw new EnvironmentVariableError(variableName);
  }
  return value;
}

export function getOptionalEnvironmentVariable(
  variableName: string,
  defaultValue: string
): string {
  const value = process.env[variableName];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value;
}

export function getAmapApiKey(): string {
  return getRequiredEnvironmentVariable('AMAP_API_KEY');
}

export function getAmapJsApiKey(): string {
  const value = process.env.NEXT_PUBLIC_AMAP_JS_API_KEY;
  if (value === undefined || value === '') {
    throw new EnvironmentVariableError('NEXT_PUBLIC_AMAP_JS_API_KEY');
  }
  return value;
}

export function getAmapJsApiSecret(): string {
  const value = process.env.NEXT_PUBLIC_AMAP_JS_API_SECRET;
  if (value === undefined || value === '') {
    throw new EnvironmentVariableError('NEXT_PUBLIC_AMAP_JS_API_SECRET');
  }
  return value;
}

export function getBailianApiKey(): string {
  return getRequiredEnvironmentVariable('BAILIAN_API_KEY');
}

export function getBailianBaseUrl(): string {
  return getOptionalEnvironmentVariable(
    'BAILIAN_BASE_URL',
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  );
}

export function getBailianModelName(): string {
  return getOptionalEnvironmentVariable('BAILIAN_MODEL', 'deepseek-v4-flash');
}

export function getRateLimitMax(): number {
  const value = getOptionalEnvironmentVariable('LLM_SERVICE_RATE_LIMIT_MAX', '10');
  return parseInt(value, 10);
}

export function getRateLimitWindowMs(): number {
  const value = getOptionalEnvironmentVariable('LLM_SERVICE_RATE_LIMIT_WINDOW_MS', '3600000');
  return parseInt(value, 10);
}

export function getPoiCacheTtlMs(): number {
  const value = getOptionalEnvironmentVariable('POI_CACHE_TTL_MS', '1800000');
  return parseInt(value, 10);
}