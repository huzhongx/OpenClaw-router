import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderChoice,
  StreamChunk,
  ProviderError,
} from '../types';
import { BaseProvider } from './base';

export class OpenAIProvider extends BaseProvider {
  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.buildBody(request);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    const data: any = await res.json();

    // Handle non-standard response formats
    // Some providers return { result, choices } or { output, data } instead of { choices }
    if (!data.choices && (data.result || data.output || data.data || data.content)) {
      const text = data.result || data.output || (Array.isArray(data.data) ? data.data[0]?.content : null) || data.content || '';
      data.choices = [{
        index: 0,
        message: { role: 'assistant', content: typeof text === 'string' ? text : JSON.stringify(text) },
        finish_reason: 'stop',
      }];
      if (!data.usage) {
        data.usage = { prompt_tokens: data.prompt_tokens || data.input_tokens || 0, completion_tokens: data.completion_tokens || data.output_tokens || 0, total_tokens: 0 };
        data.usage.total_tokens = data.usage.prompt_tokens + data.usage.completion_tokens;
      }
      if (!data.id) data.id = `ocr-${Date.now()}`;
      if (!data.model) data.model = this.config.name;
    }

    return this.transformResponse(data);
  }

  async *chatStream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const body = this.buildBody({ ...request, stream: true });
    // Use manual AbortController + clearTimeout so timeout only covers fetch(),
    // NOT the subsequent stream reading.
    // Cap at 120s but respect shorter provider timeouts (e.g. 30s).
    const CONNECT_TIMEOUT = Math.min(120_000, this.timeout);
    const connectController = new AbortController();
    const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT);
    let res: Response;
    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, connectController.signal])
        : connectController.signal;
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: fetchSignal,
      });
    } catch (err: any) {
      clearTimeout(connectTimer);
      if (connectController.signal.aborted && !signal?.aborted) {
        const pe = new Error(`Upstream connection timeout (${Math.round(CONNECT_TIMEOUT / 1000)}s)`) as Error & ProviderError;
        pe.status = 504;
        pe.retryable = true;
        pe.code = 'upstream_timeout';
        throw pe;
      }
      throw err;
    }
    clearTimeout(connectTimer);

    if (!res.ok) {
      await this.handleError(res);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield {
            id: parsed.id,
            model: parsed.model,
            choices: (parsed.choices || []).map((c: any) => ({
              index: c.index ?? 0,
              delta: c.delta || {},
              finish_reason: c.finish_reason || null,
            })),
            usage: parsed.usage || undefined,
          };
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

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

  protected headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private buildBody(request: ProviderRequest): any {
    const body: any = {
      model: request.model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
    if (request.stop) body.stop = request.stop;
    if (request.stream !== undefined) body.stream = request.stream;
    if (request.stream) body.stream_options = { include_usage: true };
    if (request.tools?.length) body.tools = request.tools;
    if (request.tool_choice) body.tool_choice = request.tool_choice;
    if (request.response_format) body.response_format = request.response_format;
    if (request.user) body.user = request.user;
    return body;
  }

  private transformResponse(data: any): ProviderResponse {
    return {
      id: data.id,
      model: data.model,
      choices: (data.choices || []).map((c: any): ProviderChoice => ({
        index: c.index ?? 0,
        message: c.message || { role: 'assistant', content: null },
        finish_reason: c.finish_reason || null,
      })),
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    };
  }

  private async handleError(res: Response): Promise<never> {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const data: any = await res.json();
      message = data.error?.message || message;
      code = data.error?.code;
    } catch { /* ignore parse error */ }

    const err = new Error(message) as Error & ProviderError;
    err.status = res.status;
    err.code = code;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
}
