import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicLLMClient } from './AnthropicLLMClient';
import { LLMClientFactory } from './LLMClientFactory';
import { OpenAICompatibleLLMClient } from './OpenAICompatibleLLMClient';

describe('LLMClientFactory', () => {
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalProvider;
  });

  it('returns AnthropicLLMClient when LLM_PROVIDER=anthropic', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const client = LLMClientFactory.create();
    expect(client).toBeInstanceOf(AnthropicLLMClient);
  });

  it('returns OpenAICompatibleLLMClient when LLM_PROVIDER=openai-compatible', () => {
    process.env.LLM_PROVIDER = 'openai-compatible';
    const client = LLMClientFactory.create();
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });

  it('defaults to OpenAI-compatible when env is unset', () => {
    delete process.env.LLM_PROVIDER;
    const client = LLMClientFactory.create();
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });

  it('falls back to OpenAI-compatible for an unknown value (with warning)', () => {
    process.env.LLM_PROVIDER = 'bogus-provider';
    const client = LLMClientFactory.create();
    expect(client).toBeInstanceOf(OpenAICompatibleLLMClient);
  });
});