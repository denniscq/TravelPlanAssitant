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

/**
 * Which LLM provider adapter to instantiate. Validated against an
 * explicit allow-list so a typo doesn't silently fall back to a
 * different endpoint.
 */
export function getLLMProvider(): 'anthropic' | 'openai-compatible' {
  const value = getOptionalEnvironmentVariable('LLM_PROVIDER', 'openai-compatible');
  if (value === 'anthropic' || value === 'openai-compatible') {
    return value;
  }
  // Misconfigured: warn and fall back to the safe default.
  console.warn(
    `[environment] Unknown LLM_PROVIDER="${value}", falling back to "openai-compatible"`
  );
  return 'openai-compatible';
}

// --- Anthropic-format provider (Anthropic proper + MiniMax /anthropic) ---

export function getAnthropicApiKey(): string {
  // Prefer the dedicated env var, but allow the historical BAILIAN_API_KEY
  // to keep working so existing deployments don't need a rename.
  return getOptionalEnvironmentVariable(
    'ANTHROPIC_API_KEY',
    getOptionalEnvironmentVariable('BAILIAN_API_KEY', '')
  );
}

export function getAnthropicBaseUrl(): string {
  return getOptionalEnvironmentVariable(
    'ANTHROPIC_BASE_URL',
    getOptionalEnvironmentVariable('BAILIAN_BASE_URL', 'https://api.minimaxi.com/anthropic')
  );
}

export function getAnthropicModelName(): string {
  return getOptionalEnvironmentVariable(
    'ANTHROPIC_MODEL',
    getOptionalEnvironmentVariable('BAILIAN_MODEL', 'MiniMax-M2.5-highspeed')
  );
}

export function getAnthropicVersion(): string {
  return getOptionalEnvironmentVariable('ANTHROPIC_VERSION', '2023-06-01');
}

// --- OpenAI-compatible provider (Bailian, OpenRouter, Together, ...) ---

export function getOpenAIApiKey(): string {
  return getOptionalEnvironmentVariable(
    'OPENAI_API_KEY',
    getOptionalEnvironmentVariable('BAILIAN_API_KEY', '')
  );
}

export function getOpenAIBaseUrl(): string {
  return getOptionalEnvironmentVariable(
    'OPENAI_BASE_URL',
    getOptionalEnvironmentVariable(
      'BAILIAN_BASE_URL',
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    )
  );
}

export function getOpenAIModelName(): string {
  return getOptionalEnvironmentVariable(
    'OPENAI_MODEL',
    getOptionalEnvironmentVariable('BAILIAN_MODEL', 'deepseek-v4-flash')
  );
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

/**
 * Upper bound on the number of waiting requests the
 * `RoutePlanQueue` will accept before new enqueues are rejected
 * with `QueueFullError`. Default is 5, meaning at most 1 active
 * and 4 waiting requests may coexist. Invalid values (non-numeric
 * or less than 1) fall back to the default so a typo doesn't
 * accidentally disable the queue.
 */
export function getRoutePlanQueueMaxLength(): number {
  const raw = getOptionalEnvironmentVariable(
    'ROUTE_PLAN_QUEUE_MAX_LENGTH',
    '5',
  );
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    console.warn(
      `[environment] Invalid ROUTE_PLAN_QUEUE_MAX_LENGTH="${raw}", falling back to default 5`
    );
    return 5;
  }
  return parsed;
}