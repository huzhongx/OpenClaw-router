import { OpenAIProvider } from './openai';

// Generic OpenAI-compatible adapter: Ollama, vLLM, LiteLLM, text-generation-webui, etc.
// These all expose the same /v1/chat/completions endpoint format as OpenAI.
export class OpenAICompatibleProvider extends OpenAIProvider {
  // Inherits everything from OpenAIProvider — just changes the base URL.
  // The only difference is testConnection: some local providers don't have /models.
  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      // If /models fails, try a lightweight chat completion
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: 'test',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(10000),
        });
        return res.ok || res.status === 400; // 400 means connected but invalid model
      } catch {
        return false;
      }
    }
  }
}
