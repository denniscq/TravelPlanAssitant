import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleLLMClient } from './OpenAICompatibleLLMClient';

describe('OpenAICompatibleLLMClient', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_BASE_URL;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_BASE_URL = 'https://example.com/openai';
    process.env.OPENAI_MODEL = 'gpt-test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBase;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
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

  it('appends /chat/completions and uses Bearer auth', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
    });
    const client = new OpenAICompatibleLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/openai/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-openai-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends response_format=json_object when forceJson is true', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    });
    const client = new OpenAICompatibleLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format when forceJson is false', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    });
    const client = new OpenAICompatibleLLMClient();
    await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: false,
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('sends system + user messages in the right roles', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    });
    const client = new OpenAICompatibleLLMClient();
    await client.chat({
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      forceJson: false,
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });

  it('strips code fences from the assistant content', async () => {
    mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '```json\n{"a":1}\n```' } }],
    });
    const client = new OpenAICompatibleLLMClient();
    const resp = await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: true,
    });
    expect(JSON.parse(resp.jsonText)).toEqual({ a: 1 });
  });

  it('reports token usage when present', async () => {
    mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: '{}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
    const client = new OpenAICompatibleLLMClient();
    const resp = await client.chat({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      forceJson: false,
    });
    expect(resp.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('throws on non-2xx responses', async () => {
    mockFetchOnce({}, { status: 401 });
    const client = new OpenAICompatibleLLMClient();
    await expect(
      client.chat({ systemPrompt: 'sys', userPrompt: 'usr', forceJson: false }),
    ).rejects.toThrow(/status 401/);
  });

  it('throws when content is missing from the response', async () => {
    mockFetchOnce({ choices: [{ message: { content: null } }] });
    const client = new OpenAICompatibleLLMClient();
    await expect(
      client.chat({ systemPrompt: 'sys', userPrompt: 'usr', forceJson: false }),
    ).rejects.toThrow(/Empty content/);
  });

  it('exposes providerName "openai-compatible"', () => {
    expect(new OpenAICompatibleLLMClient().providerName).toBe('openai-compatible');
  });
});