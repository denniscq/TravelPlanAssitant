import {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from './ILLMClient';
import {
  getOpenAIApiKey,
  getOpenAIBaseUrl,
  getOpenAIModelName,
} from '../../utils/environment';

/**
 * Wire types for OpenAI-compatible chat-completion endpoints.
 * Same shape works for Bailian's compatible-mode, OpenRouter, Together, etc.
 */
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

interface OpenAIChatResponse {
  id?: string;
  choices?: {
    finish_reason?: string;
    message?: { role?: string; content?: string };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Adapter for any provider that exposes an OpenAI-compatible
 * `/chat/completions` endpoint.
 */
export class OpenAICompatibleLLMClient implements ILLMClient {
  public readonly providerName = 'openai-compatible';

  public async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const body: OpenAIChatRequest = {
      model: getOpenAIModelName(),
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    };

    if (request.forceJson) {
      body.response_format = { type: 'json_object' };
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    // Apply a hard 90-second timeout via AbortSignal so a slow upstream
    // (long prompts with route data + extended thinking frequently need
    // 60-90 seconds end-to-end) doesn't get cut off mid-generation. A short
    // timeout would cause spurious failures; the caller (LLMService) already
    // implements 3-attempt retry that immediately re-runs on timeout errors.
    const REQUEST_TIMEOUT_MS = 90_000;
    const response = await fetch(getOpenAIBaseUrl() + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getOpenAIApiKey()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible API returned status ${response.status}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as OpenAIChatResponse;
    if (data.error) {
      throw new Error(
        `OpenAI-compatible API error: ${data.error.message ?? 'unknown'}`,
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty content in OpenAI-compatible response');
    }

    return {
      jsonText: this.stripCodeFences(content),
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
  }
}