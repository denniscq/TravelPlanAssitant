import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EnvironmentVariableError,
  getAnthropicApiKey,
  getAnthropicBaseUrl,
  getAnthropicModelName,
  getLLMProvider,
  getOpenAIApiKey,
  getOpenAIBaseUrl,
  getOpenAIModelName,
  getPoiCacheTtlMs,
  getRateLimitMax,
  getRateLimitWindowMs,
  getRequiredEnvironmentVariable,
  getRoutePlanQueueMaxLength,
} from './environment';

describe('environment', () => {
  // Save & restore env around each test to avoid bleeding state.
  const savedEnv: Record<string, string | undefined> = {};
  const tracked = [
    'AMAP_API_KEY',
    'BAILIAN_API_KEY',
    'BAILIAN_BASE_URL',
    'BAILIAN_MODEL',
    'LLM_PROVIDER',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_VERSION',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'LLM_SERVICE_RATE_LIMIT_MAX',
    'LLM_SERVICE_RATE_LIMIT_WINDOW_MS',
    'POI_CACHE_TTL_MS',
    'ROUTE_PLAN_QUEUE_MAX_LENGTH',
  ];
  beforeEach(() => {
    for (const k of tracked) savedEnv[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of tracked) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('getRequiredEnvironmentVariable', () => {
    it('returns the value when set', () => {
      process.env.MY_VAR = 'hello';
      expect(getRequiredEnvironmentVariable('MY_VAR')).toBe('hello');
      delete process.env.MY_VAR;
    });

    it('throws EnvironmentVariableError when missing', () => {
      delete process.env.MY_MISSING;
      expect(() => getRequiredEnvironmentVariable('MY_MISSING')).toThrow(EnvironmentVariableError);
    });

    it('throws when the value is the empty string', () => {
      process.env.MY_EMPTY = '';
      expect(() => getRequiredEnvironmentVariable('MY_EMPTY')).toThrow(EnvironmentVariableError);
    });
  });

  describe('getLLMProvider', () => {
    it('returns "openai-compatible" by default', () => {
      delete process.env.LLM_PROVIDER;
      expect(getLLMProvider()).toBe('openai-compatible');
    });

    it('returns "anthropic" when configured', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      expect(getLLMProvider()).toBe('anthropic');
    });

    it('falls back with warning on unknown values', () => {
      process.env.LLM_PROVIDER = 'whoknows';
      expect(getLLMProvider()).toBe('openai-compatible');
    });
  });

  describe('Anthropic provider env', () => {
    it('uses ANTHROPIC_API_KEY when present', () => {
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      process.env.BAILIAN_API_KEY = 'bailian-key';
      expect(getAnthropicApiKey()).toBe('ant-key');
    });

    it('falls back to BAILIAN_API_KEY when ANTHROPIC_API_KEY is unset', () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.BAILIAN_API_KEY = 'bailian-key';
      expect(getAnthropicApiKey()).toBe('bailian-key');
    });

    it('returns the configured Anthropic base URL', () => {
      process.env.ANTHROPIC_BASE_URL = 'https://custom.example/v1';
      expect(getAnthropicBaseUrl()).toBe('https://custom.example/v1');
    });

    it('returns the configured Anthropic model', () => {
      process.env.ANTHROPIC_MODEL = 'claude-test';
      expect(getAnthropicModelName()).toBe('claude-test');
    });
  });

  describe('OpenAI-compatible provider env', () => {
    it('uses OPENAI_API_KEY when present', () => {
      process.env.OPENAI_API_KEY = 'oai-key';
      process.env.BAILIAN_API_KEY = 'bailian-key';
      expect(getOpenAIApiKey()).toBe('oai-key');
    });

    it('returns the configured OpenAI base URL', () => {
      process.env.OPENAI_BASE_URL = 'https://oai.example/v1';
      expect(getOpenAIBaseUrl()).toBe('https://oai.example/v1');
    });

    it('returns the configured OpenAI model', () => {
      process.env.OPENAI_MODEL = 'gpt-test';
      expect(getOpenAIModelName()).toBe('gpt-test');
    });
  });

  describe('numeric env helpers', () => {
    it('getRateLimitMax parses an integer', () => {
      process.env.LLM_SERVICE_RATE_LIMIT_MAX = '42';
      expect(getRateLimitMax()).toBe(42);
    });

    it('getRateLimitMax defaults to 10', () => {
      delete process.env.LLM_SERVICE_RATE_LIMIT_MAX;
      expect(getRateLimitMax()).toBe(10);
    });

    it('getRateLimitWindowMs parses milliseconds', () => {
      process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS = '120000';
      expect(getRateLimitWindowMs()).toBe(120000);
    });

    it('getPoiCacheTtlMs parses milliseconds', () => {
      process.env.POI_CACHE_TTL_MS = '60000';
      expect(getPoiCacheTtlMs()).toBe(60000);
    });

    it('getPoiCacheTtlMs defaults to 30 minutes', () => {
      delete process.env.POI_CACHE_TTL_MS;
      expect(getPoiCacheTtlMs()).toBe(1_800_000);
    });
  });

  describe('getRoutePlanQueueMaxLength', () => {
    it('parses a positive integer', () => {
      process.env.ROUTE_PLAN_QUEUE_MAX_LENGTH = '7';
      expect(getRoutePlanQueueMaxLength()).toBe(7);
    });

    it('defaults to 5', () => {
      delete process.env.ROUTE_PLAN_QUEUE_MAX_LENGTH;
      expect(getRoutePlanQueueMaxLength()).toBe(5);
    });

    it('falls back to 5 on non-numeric values', () => {
      process.env.ROUTE_PLAN_QUEUE_MAX_LENGTH = 'not-a-number';
      expect(getRoutePlanQueueMaxLength()).toBe(5);
    });

    it('falls back to 5 on zero', () => {
      process.env.ROUTE_PLAN_QUEUE_MAX_LENGTH = '0';
      expect(getRoutePlanQueueMaxLength()).toBe(5);
    });

    it('falls back to 5 on negative values', () => {
      process.env.ROUTE_PLAN_QUEUE_MAX_LENGTH = '-3';
      expect(getRoutePlanQueueMaxLength()).toBe(5);
    });
  });
});