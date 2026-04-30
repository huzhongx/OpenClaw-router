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
} from '../types';
import { BaseProvider } from './base';

// Google Gemini API format conversion
// https://ai.google.dev/api/generate-content

export class GeminiProvider extends BaseProvider {
  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const { systemInstruction, contents } = this.convertRequest(request);
    const body: any = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (request.temperature !== undefined) body.generationConfig = { ...body.generationConfig, temperature: request.temperature };
    if (request.top_p !== undefined) body.generationConfig = { ...body.generationConfig, topP: request.top_p };
    if (request.max_tokens !== undefined) body.generationConfig = { ...body.generationConfig, maxOutputTokens: request.max_tokens };
    if (request.stop) body.generationConfig = { ...body.generationConfig, stopSequences: request.stop };
    if (request.tools?.length) body.tools = this.convertTools(request.tools);

    const url = `${this.baseUrl}/models/${request.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      throw await this.handleError(res);
    }

    const data = await res.json();
    return this.transformResponse(data, request.model);
  }

  async *chatStream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const { systemInstruction, contents } = this.convertRequest(request);
    const body: any = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (request.temperature !== undefined) body.generationConfig = { ...body.generationConfig, temperature: request.temperature };
    if (request.max_tokens !== undefined) body.generationConfig = { ...body.generationConfig, maxOutputTokens: request.max_tokens };
    if (request.tools?.length) body.tools = this.convertTools(request.tools);

    const url = `${this.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.mergeSignal(signal),
    });

    if (!res.ok) {
      throw await this.handleError(res);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let responseId = '';
    let partIndex = 0;

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

        try {
          const data = JSON.parse(jsonStr);
          const candidate = data.candidates?.[0];
          if (!candidate) continue;

          responseId = responseId || `gemini-${Date.now()}`;

          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.text !== undefined) {
              yield {
                id: responseId,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: { content: part.text },
                  finish_reason: null,
                }],
              };
            } else if (part.functionCall) {
              yield {
                id: responseId,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      id: `call_${partIndex++}`,
                      type: 'function',
                      function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {}),
                      },
                    }],
                  },
                  finish_reason: null,
                }],
              };
            }
          }

          if (candidate.finishReason) {
            const finishMap: Record<string, string> = {
              'STOP': 'stop',
              'MAX_TOKENS': 'length',
              'SAFETY': 'content_filter',
              'RECITATION': 'content_filter',
            };
            yield {
              id: responseId,
              model: request.model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: finishMap[candidate.finishReason] || candidate.finishReason || 'stop',
              }],
              usage: data.usageMetadata ? {
                prompt_tokens: data.usageMetadata.promptTokenCount || 0,
                completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
                total_tokens: data.usageMetadata.totalTokenCount || 0,
              } : undefined,
            };
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private convertRequest(request: ProviderRequest): { systemInstruction?: any; contents: any[] } {
    let systemInstruction: any = undefined;
    const contents: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : (msg.content as ContentPart[]).map(p => p.text || '').join('');
        systemInstruction = { parts: [{ text }] };
        continue;
      }

      const roleMap: Record<string, string> = {
        'user': 'user',
        'assistant': 'model',
        'tool': 'user',
      };

      const content: any[] = [];
      if (typeof msg.content === 'string') {
        content.push({ text: msg.content });
      } else {
        for (const part of msg.content as ContentPart[]) {
          if (part.type === 'text') {
            content.push({ text: part.text });
          } else if (part.type === 'image_url' && part.image_url?.url) {
            const match = part.image_url.url.match(/^data:(.+);base64,(.+)$/);
            if (match) {
              content.push({
                inlineData: { mimeType: match[1], data: match[2] },
              });
            }
          }
        }
      }

      if (msg.role === 'tool' && msg.tool_call_id) {
        // Gemini doesn't have a native tool result format in the same way
        // We wrap it as a user message with function response
        const text = typeof msg.content === 'string' ? msg.content : '';
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || '',
              response: { result: text },
            },
          }],
        });
        continue;
      }

      // Handle tool_calls in assistant messages
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          content.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            },
          });
        }
      }

      if (content.length > 0) {
        contents.push({
          role: roleMap[msg.role] || 'user',
          parts: content,
        });
      }
    }

    return { systemInstruction, contents };
  }

  private convertTools(tools: ToolDef[]): any[] {
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        parameters: t.function.parameters || { type: 'object', properties: {} },
      })),
    }];
  }

  private transformResponse(data: any, model: string): ProviderResponse {
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return {
        id: `gemini-${Date.now()}`,
        model,
        choices: [],
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
          completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: data.usageMetadata?.totalTokenCount || 0,
        },
      };
    }

    const parts = candidate.content?.parts || [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.text !== undefined) {
        textParts.push(part.text);
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${i}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      }
    }

    const finishMap: Record<string, string> = {
      'STOP': 'stop',
      'MAX_TOKENS': 'length',
      'SAFETY': 'content_filter',
    };

    const message: ProviderChoice['message'] = {
      role: 'assistant',
      content: textParts.join('') || null,
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    return {
      id: `gemini-${Date.now()}`,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: (finishMap[candidate.finishReason] || candidate.finishReason || null) as any,
      }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  private async handleError(res: Response): Promise<never> {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const data: any = await res.json();
      message = data.error?.message || message;
      code = data.error?.status;
    } catch { /* ignore */ }

    const err = new Error(message) as Error & ProviderError;
    err.status = res.status;
    err.code = code;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
}
