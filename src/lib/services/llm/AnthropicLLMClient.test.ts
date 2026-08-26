import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLLMClient } from './AnthropicLLMClient';

describe('AnthropicLLMClient', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalBase = process.env.ANTHROPIC_BASE_URL;
  const originalModel = process.env.ANTHROPIC_MODEL;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.ANTHROPIC_BASE_URL = 'https://example.com/v1/messages';
    process.env.ANTHROPIC_MODEL = 'claude-test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBase;
    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = originalModel;
  });

  function mockFetchOnce(body: unknown, init?: { status?: number }) {
    const status = init?.status ?? 200;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('sends a POST to the configured base URL with x-api-key header', async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: 'tool_use', name: 'return_route_plan', input: { ok: true } }],
    });
    const client = new AnthropicLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-anthropic-key');
    expect(headers['anthropic-version']).toBeTruthy();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('includes tool_choice when forceJson is true', async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: 'tool_use', name: 'return_route_plan', input: {} }],
    });
    const client = new AnthropicLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('return_route_plan');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'return_route_plan' });
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('omits tools when forceJson is false', async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: 'text', text: 'hello' }],
    });
    const client = new AnthropicLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: false,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('extracts JSON from a tool_use content block', async () => {
    mockFetchOnce({
      content: [{
        type: 'tool_use',
        name: 'return_route_plan',
        input: { orderedPoiIds: ['a', 'b'] },
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = new AnthropicLLMClient();
    const resp = await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });

    expect(JSON.parse(resp.jsonText)).toEqual({ orderedPoiIds: ['a', 'b'] });
    expect(resp.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('falls back to text content when tool_use is missing', async () => {
    mockFetchOnce({
      content: [{ type: 'text', text: '{"foo":1}' }],
    });
    const client = new AnthropicLLMClient();
    const resp = await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: false,
    });
    expect(JSON.parse(resp.jsonText)).toEqual({ foo: 1 });
  });

  it('throws on non-2xx responses', async () => {
    mockFetchOnce({}, { status: 500 });
    const client = new AnthropicLLMClient();
    await expect(
      client.chat({ systemPrompt: 'sys', userPrompt: 'usr', forceJson: false }),
    ).rejects.toThrow(/status 500/);
  });

  it('throws when the response has no extractable content', async () => {
    mockFetchOnce({ content: [], stop_reason: 'end_turn' });
    const client = new AnthropicLLMClient();
    await expect(
      client.chat({ systemPrompt: 'sys', userPrompt: 'usr', forceJson: true }),
    ).rejects.toThrow(/did not contain a return_route_plan/);
  });

  it('exposes providerName "anthropic"', () => {
    expect(new AnthropicLLMClient().providerName).toBe('anthropic');
  });
});