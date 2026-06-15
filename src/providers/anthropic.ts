import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderChoice,
  ProviderMessage,
  ContentPart,
  ToolCall,
  ToolDef,
  StreamChunk,
  ProviderError,
  TokenUsage,
} from '../types';
import { BaseProvider } from './base';

// Anthropic messages API format conversion
// https://docs.anthropic.com/en/api/messages

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string | any[] }
  | { type: 'thinking'; thinking: string }
  | { type: 'redacted_thinking'; data: string };

export class AnthropicProvider extends BaseProvider {
  private version = '2023-06-01';

  constructor(config: ProviderConfig) {
    super(config);
    if (config.extra?.anthropic_version) {
      this.version = config.extra.anthropic_version;
    }
  }

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const { system, messages } = this.convertMessages(request.messages);
    const body: any = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 16384,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
    if (request.stop) body.stop_sequences = request.stop;
    if (request.tools?.length) body.tools = this.convertTools(request.tools);
    if (request.tool_choice) body.tool_choice = request.tool_choice;
    if (request.thinking) body.thinking = request.thinking;
    if (request.user) body.metadata = { user_id: request.user };

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      throw await this.handleError(res);
    }

    const data = await res.json();
    return this.transformResponse(data);
  }

  async *chatStream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const { system, messages } = this.convertMessages(request.messages);
    const body: any = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 16384,
      stream: true,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
    if (request.stop) body.stop_sequences = request.stop;
    if (request.tools?.length) body.tools = this.convertTools(request.tools);
    if (request.tool_choice) body.tool_choice = request.tool_choice;
    if (request.thinking) body.thinking = request.thinking;

    // Connection timeout: establish connection and receive headers from upstream.
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
      res = await fetch(`${this.baseUrl}/messages`, {
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
      throw await this.handleError(res);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let responseId = '';
    let modelName = request.model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') return;

        try {
          const event = JSON.parse(jsonStr);
          const eventType = event.type;
          responseId = event.id || responseId;
          modelName = event.model || modelName;

          if (eventType === 'content_block_start') {
            const block = event.content_block;
            if (block?.type === 'tool_use') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      id: block.id || '',
                      type: 'function',
                      function: { name: block.name || '', arguments: '' },
                    }],
                  },
                  finish_reason: null,
                }],
              };
            } else if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: { thinking: block.type === 'thinking' ? '' : undefined, thinking_signature: block.type === 'redacted_thinking' ? (block as any).data || '' : undefined },
                  finish_reason: null,
                }],
              };
            }
          } else if (eventType === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: { content: delta.text },
                  finish_reason: null,
                }],
              };
            } else if (delta.type === 'input_json_delta') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      id: '',
                      type: 'function',
                      function: { name: '', arguments: delta.partial_json || '' },
                    }],
                  },
                  finish_reason: null,
                }],
              };
            } else if (delta.type === 'thinking_delta') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: { thinking: delta.thinking || '' },
                  finish_reason: null,
                }],
              };
            } else if (delta.type === 'signature_delta') {
              yield {
                id: responseId,
                model: modelName,
                choices: [{
                  index: 0,
                  delta: { thinking_signature: delta.signature || '' },
                  finish_reason: null,
                }],
              };
            }
          } else if (eventType === 'message_delta') {
            const stopReason = event.delta?.stop_reason;
            const finishMap: Record<string, string> = {
              'end_turn': 'stop',
              'max_tokens': 'length',
              'tool_use': 'tool_calls',
              'stop_sequence': 'stop',
            };
            yield {
              id: responseId,
              model: modelName,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: finishMap[stopReason] || stopReason || null,
              }],
              usage: event.usage ? {
                // Anthropic reports input_tokens as the *new* (non-cached) tokens
                // in this call. cache_read + cache_creation are additional tokens
                // served from / written to the cache. The total prompt the model
                // actually saw is the sum. Normalize to OpenAI's semantic where
                // prompt_tokens is the full prompt size, so the rest of the
                // router (billing, cache %, dashboard) treats both providers
                // consistently.
                prompt_tokens: (event.usage.input_tokens || 0) + (event.usage.cache_read_input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0),
                completion_tokens: event.usage.output_tokens || 0,
                total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0) + (event.usage.cache_read_input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0),
                cache_read_input_tokens: event.usage.cache_read_input_tokens || 0,
                cache_creation_input_tokens: event.usage.cache_creation_input_tokens || 0,
              } : undefined,
            };
          } else if (eventType === 'message_start') {
            yield {
              id: event.id || responseId,
              model: event.model || modelName,
              choices: [{
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null,
              }],
              usage: event.message?.usage ? {
                prompt_tokens: (event.message.usage.input_tokens || 0) + (event.message.usage.cache_read_input_tokens || 0) + (event.message.usage.cache_creation_input_tokens || 0),
                completion_tokens: 0,
                total_tokens: event.message.usage.input_tokens || 0,
                cache_read_input_tokens: event.message.usage.cache_read_input_tokens || 0,
                cache_creation_input_tokens: event.message.usage.cache_creation_input_tokens || 0,
              } : undefined,
            };
          } else if (eventType === 'message_stop') {
            return;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.version,
      'anthropic-beta': 'prompt-caching-2024-07-31',
    };
    if (this.apiKey) {
      // Support both auth styles: x-api-key (Anthropic) and Authorization (GLM/Zhipu)
      if (this.config.extra?.auth_type === 'bearer' || this.config.extra?.auth_type === 'authorization') {
        h['Authorization'] = this.apiKey;
      } else {
        h['x-api-key'] = this.apiKey;
      }
    }
    return h;
  }

  private convertMessages(messages: ProviderMessage[]): { system: any; messages: AnthropicMessage[] } {
    let system: any = '';
    const systemBlocks: any[] = [];
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          system += (system ? '\n' : '') + msg.content;
        } else {
          for (const part of msg.content as ContentPart[]) {
            const block: any = { type: 'text', text: part.text || '' };
            if (part.cache_control) block.cache_control = part.cache_control;
            systemBlocks.push(block);
          }
        }
        continue;
      }

      if (msg.role === 'tool') {
        // Tool result -> append to last assistant message's content
        const text = typeof msg.content === 'string' ? msg.content : (msg.content as ContentPart[]).map(p => p.text || '').join('');
        const lastMsg = result[result.length - 1];
        if (lastMsg) {
          result.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id || '', content: text }],
          });
        }
        continue;
      }

      const anthropicMsg: AnthropicMessage = {
        role: msg.role as 'user' | 'assistant',
        content: [],
      };

      if (typeof msg.content === 'string') {
        anthropicMsg.content = [{ type: 'text', text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        const parts = msg.content as ContentPart[];
        for (const part of parts) {
          if (part.type === 'text') {
            const block: any = { type: 'text', text: part.text || '' };
            if (part.cache_control) block.cache_control = part.cache_control;
            anthropicMsg.content.push(block);
          } else if (part.type === 'image_url' && part.image_url?.url) {
            // Extract base64 data from data URL
            const match = part.image_url.url.match(/^data:(.+);base64,(.+)$/);
            if (match) {
              const block: any = {
                type: 'image',
                source: { type: 'base64', media_type: match[1], data: match[2] },
              };
              if (part.cache_control) block.cache_control = part.cache_control;
              anthropicMsg.content.push(block);
            }
          }
        }
      }

      // Handle tool_calls in assistant messages
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          anthropicMsg.content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }

      // Reconstruct thinking blocks preserved from original Anthropic messages
      const thinkingBlocks = (msg as any)._thinking_blocks;
      if (Array.isArray(thinkingBlocks)) {
        for (const tb of thinkingBlocks) {
          if (tb.type === 'thinking') {
            anthropicMsg.content.push({ type: 'thinking', thinking: tb.thinking || '' });
          } else if (tb.type === 'redacted_thinking') {
            anthropicMsg.content.push({ type: 'redacted_thinking', data: tb.data || '' });
          }
        }
      }

      result.push(anthropicMsg);
    }

    // Anthropic requires alternating user/assistant, and first message must be user
    if (result.length > 0 && result[0].role === 'assistant') {
      result.unshift({ role: 'user', content: [{ type: 'text', text: '.' }] });
    }

    // Use structured system blocks if any had cache_control, otherwise plain string
    const systemValue = systemBlocks.length > 0 ? systemBlocks : (system || undefined);
    return { system: systemValue, messages: result };
  }

  private convertTools(tools: ToolDef[]): any[] {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
  }

  private transformResponse(data: any): ProviderResponse {
    const finishMap: Record<string, string> = {
      'end_turn': 'stop',
      'max_tokens': 'length',
      'tool_use': 'tool_calls',
      'stop_sequence': 'stop',
    };

    const toolCalls: ToolCall[] = [];
    const textParts: string[] = [];
    const thinkingBlocks: any[] = [];

    for (const block of (data.content || [])) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        });
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        thinkingBlocks.push(block);
      }
    }

    const message: ProviderChoice['message'] = {
      role: 'assistant',
      content: textParts.join('') || null,
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    if (thinkingBlocks.length > 0) {
      (message as any)._thinking_blocks = thinkingBlocks;
    }

    return {
      id: data.id,
      model: data.model,
      choices: [{
        index: 0,
        message,
        finish_reason: finishMap[data.stop_reason] || data.stop_reason || null,
      }],
      usage: {
        prompt_tokens: (data.usage?.input_tokens || 0) + (data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0),
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) + (data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0),
        cache_read_input_tokens: data.usage?.cache_read_input_tokens || 0,
        cache_creation_input_tokens: data.usage?.cache_creation_input_tokens || 0,
      },
    };
  }

  private async handleError(res: Response): Promise<never> {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const data: any = await res.json();
      message = data.error?.message || message;
      code = data.error?.type;
    } catch { /* ignore */ }

    const err = new Error(message) as Error & ProviderError;
    err.status = res.status;
    err.code = code;
    err.retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    throw err;
  }
}
