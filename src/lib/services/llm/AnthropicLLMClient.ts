import {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from './ILLMClient';
import {
  getAnthropicApiKey,
  getAnthropicBaseUrl,
  getAnthropicModelName,
  getAnthropicVersion,
} from '../../utils/environment';

/**
 * Wire types for Anthropic Messages API. Used by both Anthropic proper
 * and MiniMax's Anthropic-compatible endpoint.
 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[] | string;
}

interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'tool'; name: string };
  temperature?: number;
}

interface AnthropicMessagesResponse {
  id?: string;
  stop_reason?: string;
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

/**
 * JSON schema that mirrors the LlmRoutePlanResponse shape the
 * orchestration layer expects. Anthropic / MiniMax force JSON
 * output by defining a single tool and requiring the model to
 * call it — the tool's `input` is then guaranteed to match the
 * schema.
 */
const ROUTE_PLAN_TOOL: AnthropicTool = {
  name: 'return_route_plan',
  description:
    'Return the one-day route plan as structured JSON. Always invoke this tool exactly once with the complete plan as input. Do not return plain text.',
  input_schema: {
    type: 'object',
    properties: {
      orderedPoiIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Ordered list of every POI ID in the planned visiting sequence.',
      },
      stopDescriptions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            poiId: { type: 'string' },
            suggestedArrival: { type: 'string' },
            suggestedDuration: { type: 'string' },
            notes: { type: 'string' },
            transportMode: { type: 'string' },
            transportDistance: { type: 'string' },
            transportDuration: { type: 'string' },
            recommendedDishes: {
              type: 'array',
              items: { type: 'string' },
            },
            ticketPrice: { type: 'number' },
          },
          required: ['poiId'],
        },
      },
      markdownPlan: { type: 'string' },
      costBreakdown: {
        type: 'object',
        properties: {
          tickets: { type: 'number' },
          meals: { type: 'number' },
          transportation: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['tickets', 'meals', 'transportation', 'total'],
      },
    },
    required: [
      'orderedPoiIds',
      'stopDescriptions',
      'markdownPlan',
      'costBreakdown',
    ],
  },
};

/**
 * Adapter for Anthropic-format chat APIs. Works against both the
 * real Anthropic service and MiniMax's `/anthropic` compatibility
 * endpoint.
 */
export class AnthropicLLMClient implements ILLMClient {
  public readonly providerName = 'anthropic';

  public async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const body: AnthropicMessagesRequest = {
      model: getAnthropicModelName(),
      // Default budget is generous because Anthropic models with extended
      // thinking enabled consume the first ~60-80% of `max_tokens` for
      // internal reasoning before emitting the final JSON. 20000 leaves
      // enough room for both the thinking block and the structured JSON
      // payload returned via tool_use.
      max_tokens: request.maxTokens ?? 20000,
      system: request.systemPrompt,
      messages: [
        { role: 'user', content: request.userPrompt },
      ],
    };

    if (request.forceJson) {
      body.tools = [ROUTE_PLAN_TOOL];
      body.tool_choice = { type: 'tool', name: ROUTE_PLAN_TOOL.name };
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    // Base URL is treated as the full endpoint prefix. Callers configure the
    // exact path (e.g. "https://api.minimaxi.com/anthropic" for the default
    // Anthropic-compatible endpoint, or include "/v1/messages" for providers
    // that expose a flat URL). This mirrors OpenAICompatibleLLMClient.
    //
    // Apply a hard 90-second timeout via AbortSignal so a slow upstream
    // (long prompts with route data + extended thinking frequently need
    // 60-90 seconds end-to-end) doesn't get cut off mid-generation. A short
    // timeout would cause spurious failures; the caller (LLMService) already
    // implements 3-attempt retry that immediately re-runs on timeout errors.
    const REQUEST_TIMEOUT_MS = 90_000;
    const response = await fetch(getAnthropicBaseUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getAnthropicApiKey(),
        'anthropic-version': getAnthropicVersion(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic API returned status ${response.status}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    if (data.error) {
      throw new Error(
        `Anthropic API error: ${data.error.message ?? 'unknown'}`,
      );
    }

    const jsonText = this.extractJsonText(data);
    if (!jsonText) {
      const blocks = data.content ?? [];
      const blockSummary = blocks.map((b) => b.type).join(',') || 'none';
      const stop = data.stop_reason ?? 'unknown';
      throw new Error(
        `Anthropic response did not contain a return_route_plan tool call ` +
          `(stop_reason=${stop}, blocks=[${blockSummary}])`,
      );
    }

    return {
      jsonText,
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? 0,
            outputTokens: data.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  /**
   * Anthropic returns the JSON payload inside a `tool_use` content
   * block when `tool_choice` is set. When the model emits plain text
   * instead (sometimes happens near the token limit), we fall back to
   * that text. Code fences are stripped in either case so downstream
   * JSON.parse never sees them.
   */
  private extractJsonText(response: AnthropicMessagesResponse): string {
    const blocks = response.content ?? [];
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === ROUTE_PLAN_TOOL.name) {
        return this.stripCodeFences(JSON.stringify(block.input));
      }
    }
    for (const block of blocks) {
      if (block.type === 'text') {
        return this.stripCodeFences(block.text);
      }
    }
    return '';
  }

  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
  }
}