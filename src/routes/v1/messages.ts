import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { resolveRoute, resolveModel } from '../../providers/router';
import { createProvider } from '../../providers/registry';
import { deductUsage, calculateCost, toCents } from '../../services/billing';
import { normalizeUsage, emptyUsage, isUsageValid } from '../../services/token-counter';
import { logUsage } from '../../services/usage-logger';
import { apiKeyAuth } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import type { ProviderRequest, ProviderError, StreamChunk } from '../../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============================================================
// Anthropic Messages API request schema
// ============================================================

const anthropicContentBlockSchema = z.object({
  type: z.enum(['text', 'image', 'tool_use', 'tool_result']),
  text: z.string().optional(),
  source: z.object({ type: z.literal('base64'), media_type: z.string(), data: z.string() }).optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.any().optional(),
  tool_use_id: z.string().optional(),
  content: z.any().optional(),
});

const anthropicContentSchema = z.array(anthropicContentBlockSchema);

const anthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), anthropicContentSchema]),
});

const anthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.any().optional(),
});

const messagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(anthropicMessageSchema).min(1),
  system: z.union([z.string(), z.array(anthropicContentBlockSchema)]).optional(),
  max_tokens: z.number().int().positive().optional().default(4096),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
  tools: z.array(anthropicToolSchema).optional(),
  metadata: z.any().optional(),
});

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string | any[] };

type AnthropicRequest = z.infer<typeof messagesRequestSchema>;

// ============================================================
// POST /v1/messages
// ============================================================
router.post('/messages', apiKeyAuth, rateLimit, async (req: Request, res: Response) => {
  const parsed = messagesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: parsed.error.issues.map(i => i.message).join(', '),
      },
    });
    return;
  }

  const body = parsed.data;
  const startTime = Date.now();
  const requestId = `msg_${uuidv4().slice(0, 24)}`;

  try {
    const entries = resolveRoute(body.model);

    if (body.stream) {
      return await handleStreaming(req, res, body, entries, requestId, startTime);
    }

    return await handleNonStreaming(req, res, body, entries, requestId, startTime);
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;

    logUsage({
      userId: req.userId!,
      apiKeyId: req.apiKeyId || null,
      modelId: body.model,
      providerId: '',
      providerModelId: body.model,
      requestId,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
      latencyMs,
      status: 'error',
      errorMessage: err.message || String(err),
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    const status = err.retryable !== undefined ? (err.status || 502) : 404;
    res.status(status).json({
      type: 'error',
      error: {
        type: err.code === 'model_not_found' ? 'invalid_request_error' : 'api_error',
        message: err.message || `Model not found: ${body.model}`,
      },
    });
  }
});

// ============================================================
// Convert Anthropic messages → ProviderRequest
// ============================================================

function toProviderMessages(body: AnthropicRequest): Array<{ role: string; content: string | any; tool_calls?: any; tool_call_id?: string; name?: string }> {
  const messages: Array<any> = [];

  // System prompt as first system message
  if (body.system) {
    const systemText = typeof body.system === 'string'
      ? body.system
      : (body.system as any[]).filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      const blocks = msg.content as AnthropicContentBlock[];

      // For assistant messages, extract tool_use blocks as tool_calls
      if (msg.role === 'assistant') {
        const textParts: string[] = [];
        const toolCalls: any[] = [];

        for (const block of blocks) {
          if (block.type === 'text') {
            textParts.push(block.text || '');
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {}),
              },
            });
          }
        }

        const msgObj: any = {
          role: 'assistant',
          content: textParts.join('') || null,
        };
        if (toolCalls.length > 0) {
          msgObj.tool_calls = toolCalls;
        }
        messages.push(msgObj);
      } else if (msg.role === 'user') {
        // For user messages, handle tool_result blocks
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
                : '';
            messages.push({
              role: 'tool',
              content: resultContent,
              tool_call_id: block.tool_use_id,
            });
          } else if (block.type === 'text') {
            messages.push({ role: 'user', content: block.text || '' });
          } else if (block.type === 'image') {
            // Convert to data URL format for provider
            const src = block.source;
            messages.push({
              role: 'user',
              content: `data:${src.media_type};base64,${src.data}`,
            });
          }
        }
      }
    }
  }

  return messages as any;
}

function toProviderTools(tools: AnthropicRequest['tools']): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

// ============================================================
// Convert ProviderResponse → Anthropic Messages response
// ============================================================

function toAnthropicResponse(
  response: any,
  body: AnthropicRequest,
  requestId: string,
): any {
  const content: AnthropicContentBlock[] = [];
  const stopReasonMap: Record<string, string> = {
    'stop': 'end_turn',
    'length': 'max_tokens',
    'tool_calls': 'tool_use',
    'content_filter': 'end_turn',
  };

  const choice = response.choices?.[0];
  if (!choice) {
    return {
      id: requestId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      model: body.model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  // Text content
  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  // Tool calls
  if (choice.message?.tool_calls?.length) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, any> = {};
      try {
        input = JSON.parse(tc.function?.arguments || '{}');
      } catch { /* ignore */ }

      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function?.name || '',
        input,
      });
    }
  }

  const usage = response.usage || {};

  return {
    id: response.id || requestId,
    type: 'message',
    role: 'assistant',
    content,
    model: response.model || body.model,
    stop_reason: stopReasonMap[choice.finish_reason || ''] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
  };
}

// ============================================================
// Non-streaming handler
// ============================================================

async function handleNonStreaming(
  req: Request,
  res: Response,
  body: AnthropicRequest,
  entries: any[],
  requestId: string,
  startTime: number,
): Promise<void> {
  const errors: ProviderError[] = [];
  const providerMessages = toProviderMessages(body);
  const providerTools = toProviderTools(body.tools);

  for (const entry of entries) {
    const provider = createProvider(entry.providerConfig);
    const providerRequest: ProviderRequest = {
      model: entry.providerModelId,
      messages: providerMessages as any,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      stop: body.stop_sequences,
      tools: providerTools,
      user: body.metadata?.user_id,
    };

    try {
      const response = await provider.chat(providerRequest);
      const usage = normalizeUsage(response.usage);
      const latencyMs = Date.now() - startTime;
      const model = resolveModel(body.model);
      const costCents = model ? toCents(calculateCost(usage, model)) : 0;

      if (model && req.userId) {
        deductUsage(req.userId!, usage, model);
      }

      logUsage({
        userId: req.userId!,
        apiKeyId: req.apiKeyId || null,
        modelId: body.model,
        providerId: entry.providerConfig.id,
        providerModelId: entry.providerModelId,
        requestId,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        costCents,
        latencyMs,
        status: 'success',
        errorMessage: null,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });

      res.json(toAnthropicResponse(response, body, requestId));
      return;
    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : String(err);
      const pe: ProviderError = err?.retryable !== undefined ? err : {
        status: typeof err?.status === 'number' ? err.status : 500,
        message,
        retryable: false,
      };
      errors.push(pe);
      if (!pe.retryable) break;
    }
  }

  res.status(502).json({
    type: 'error',
    error: {
      type: 'api_error',
      message: `All providers failed: ${errors.map(e => String(e.message || e)).join('; ')}`,
    },
  });
}

// ============================================================
// Streaming handler — Anthropic SSE event format
// ============================================================

async function handleStreaming(
  req: Request,
  res: Response,
  body: AnthropicRequest,
  entries: any[],
  requestId: string,
  startTime: number,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send message_start immediately so Claude Code knows the connection is alive
  res.write(`event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: requestId, type: 'message', role: 'assistant', content: [],
      model: body.model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })}\n\n`);

  // Keepalive ping — prevents intermediaries (nginx, LB) from closing idle connection
  const pingInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, 15_000);

  const clientAbort = new AbortController();
  let clientDisconnected = false;

  const onClientClose = () => {
    clientDisconnected = true;
    clientAbort.abort();
  };
  req.on('close', onClientClose);

  const cleanup = () => {
    req.off('close', onClientClose);
    clearInterval(pingInterval);
  };

  const providerMessages = toProviderMessages(body);
  const providerTools = toProviderTools(body.tools);

  const errors: ProviderError[] = [];

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const provider = createProvider(entry.providerConfig);
      const providerRequest: ProviderRequest = {
        model: entry.providerModelId,
        messages: providerMessages as any,
        temperature: body.temperature,
        top_p: body.top_p,
        max_tokens: body.max_tokens,
        stop: body.stop_sequences,
        stream: true,
        tools: providerTools,
        user: body.metadata?.user_id,
      };

      try {
        const stream = provider.chatStream(providerRequest, clientAbort.signal);
        let totalUsage = emptyUsage();
        let currentBlockIndex = -1;
        let currentBlockType: string | null = null;

        // Use a simple Transform that wraps the conversion logic
        const { Transform, Readable } = await import('stream');
        const sseTransform = new Transform({
          objectMode: true,
          transform(chunk: any, _encoding, callback) {
            if (chunk.usage && isUsageValid(chunk.usage)) totalUsage = chunk.usage;

            const choice = chunk.choices?.[0];
            if (!choice) return callback(null, null);

            let output = '';

            if (choice.delta?.role) {
              // Skip — we already sent message_start above; just update usage if available
              if (chunk.usage?.prompt_tokens) {
                // We can't retroactively update message_start usage, but track it for billing
              }
            } else if (choice.delta?.content) {
              if (currentBlockType !== 'text') {
                currentBlockIndex++;
                currentBlockType = 'text';
                output += `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: currentBlockIndex, content_block: { type: 'text', text: '' } })}\n\n`;
              }
              output += `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: currentBlockIndex, delta: { type: 'text_delta', text: choice.delta.content } })}\n\n`;
            } else if (choice.delta?.tool_calls?.length) {
              for (const tc of choice.delta.tool_calls) {
                if (tc.id && tc.id !== '') {
                  currentBlockIndex++;
                  currentBlockType = 'tool_use';
                  output += `event: content_block_stop\ndata: {"type":"content_block_stop","index":${currentBlockIndex}}\n\n`;
                  output += `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: currentBlockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name || '', input: {} } })}\n\n`;
                }
                if (tc.function?.arguments) output += `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: currentBlockIndex, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } })}\n\n`;
              }
            } else if (choice.finish_reason) {
              const stopMap: Record<string, string> = { 'stop': 'end_turn', 'length': 'max_tokens', 'tool_calls': 'tool_use', 'content_filter': 'end_turn' };
              if (currentBlockType !== null) output += `event: content_block_stop\ndata: {"type":"content_block_stop","index":${currentBlockIndex}}\n\n`;
              output += `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopMap[choice.finish_reason] || 'end_turn' }, usage: { output_tokens: totalUsage.completion_tokens || 0 } })}\n\n`;
              output += `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
            }

            callback(null, output || null);
          },
        });

        const readable = Readable.from(stream, { objectMode: true });
        readable.pipe(sseTransform).pipe(res, { end: false });

        await new Promise<void>((resolve, reject) => {
          sseTransform.on('error', reject);
          sseTransform.on('end', resolve);
        });

        if (clientDisconnected) {
          const latencyMs = Date.now() - startTime;
          const model = resolveModel(body.model);
          const costCents = model ? toCents(calculateCost(totalUsage, model)) : 0;
          if (model && req.userId && totalUsage.total_tokens > 0) {
            deductUsage(req.userId!, totalUsage, model);
          }
          logUsage({
            userId: req.userId!, apiKeyId: req.apiKeyId || null,
            modelId: body.model, providerId: entry.providerConfig.id,
            providerModelId: entry.providerModelId, requestId,
            inputTokens: totalUsage.prompt_tokens, outputTokens: totalUsage.completion_tokens,
            totalTokens: totalUsage.total_tokens, costCents, latencyMs,
            status: 'cancelled', errorMessage: 'Client disconnected',
            ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
          });
          cleanup();
          return;
        }

        res.end();

        // Post-stream billing
        const latencyMs = Date.now() - startTime;
        const model = resolveModel(body.model);
        const costCents = model ? toCents(calculateCost(totalUsage, model)) : 0;
        if (model && req.userId) {
          deductUsage(req.userId!, totalUsage, model);
        }
        logUsage({
          userId: req.userId!, apiKeyId: req.apiKeyId || null,
          modelId: body.model, providerId: entry.providerConfig.id,
          providerModelId: entry.providerModelId, requestId,
          inputTokens: totalUsage.prompt_tokens, outputTokens: totalUsage.completion_tokens,
          totalTokens: totalUsage.total_tokens, costCents, latencyMs,
          status: 'success', errorMessage: null,
          ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
        });
        cleanup();
        return;
      } catch (err: any) {
        if (clientDisconnected) break;

        const message = typeof err?.message === 'string' ? err.message : String(err);
        const pe: ProviderError = err?.retryable !== undefined ? err : {
          status: typeof err?.status === 'number' ? err.status : 500,
          message,
          retryable: false,
        };
        errors.push(pe);

        if (pe.retryable && i < entries.length - 1) {
          res.write(`: Retrying with next provider...\n\n`);
          continue;
        }
        break;
      }
    }

    // All providers failed
    const errorEvent = {
      type: 'error',
      error: {
        type: 'api_error',
        message: `All providers failed: ${errors.map(e => e.message).join('; ')}`,
      },
    };
    res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
    res.end();

    const latencyMs = Date.now() - startTime;
    logUsage({
      userId: req.userId!,
      apiKeyId: req.apiKeyId || null,
      modelId: body.model,
      providerId: entries[0]?.providerConfig?.id || '',
      providerModelId: entries[0]?.providerModelId || body.model,
      requestId,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
      latencyMs,
      status: 'error',
      errorMessage: errors.map(e => e.message).join('; '),
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });
  } finally {
    cleanup();
  }
}

export default router;
