import { ILLMClient } from './ILLMClient';
import { AnthropicLLMClient } from './AnthropicLLMClient';
import { OpenAICompatibleLLMClient } from './OpenAICompatibleLLMClient';
import { getLLMProvider } from '../../utils/environment';

export type LLMProviderName = 'anthropic' | 'openai-compatible';

/**
 * Single point of decision for which LLM adapter to instantiate.
 * Driven by `LLM_PROVIDER` in the environment; defaults to the
 * OpenAI-compatible client to preserve historical behaviour for
 * teams that haven't migrated yet.
 */
export class LLMClientFactory {
  public static create(): ILLMClient {
    const provider = getLLMProvider();
    switch (provider) {
      case 'anthropic':
        return new AnthropicLLMClient();
      case 'openai-compatible':
        return new OpenAICompatibleLLMClient();
      default:
        // Defensive fallback — `getLLMProvider` already validates.
        return new OpenAICompatibleLLMClient();
    }
  }
}