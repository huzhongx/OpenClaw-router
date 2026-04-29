import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
} from '../types';
import { OpenAIProvider } from './openai';

// Mistral API is nearly identical to OpenAI's format.
// Just inherits OpenAI and overrides what's different.
export class MistralProvider extends OpenAIProvider {
  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
