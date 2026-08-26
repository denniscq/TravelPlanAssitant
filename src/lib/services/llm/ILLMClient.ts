/**
 * Common interface every LLM provider client must implement.
 *
 * The contract is deliberately minimal: the orchestration layer
 * (LLMService) only cares about getting back a JSON document that
 * describes a route plan. Providers are responsible for translating
 * their native wire format into this single string contract.
 */
export interface LLMChatRequest {
  systemPrompt: string;
  userPrompt: string;
  /**
   * Force the model to emit valid JSON. Implementations decide whether
   * to do that via `response_format`, `tools`, grammar constraints,
   * etc. — depending on what the provider supports.
   */
  forceJson: boolean;
  /**
   * Optional per-request overrides. Useful for retries with lower
   * temperature, or dev-mode debugging.
   */
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResponse {
  /**
   * Raw JSON text returned by the model. The orchestration layer
   * parses and validates this. Providers MUST strip any wrapper
   * (markdown fences, tool-call envelopes, etc.) before returning.
   */
  jsonText: string;
  /**
   * Provider-reported token usage, when available. Optional.
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ILLMClient {
  readonly providerName: string;
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
}