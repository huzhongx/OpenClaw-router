import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { resolveRoute, resolveModel, listActiveModels, AutoRouteRequiredError, resolveRouteWithFallbacks } from '../../providers/router';
import { autoRoute } from '../../services/auto-routing';
import type { RoutingStrategy } from '../../types';
import { createProvider } from '../../providers/registry';
import { deductUsage, calculateCost, toCents } from '../../services/billing';
import { normalizeUsage, emptyUsage, isUsageValid } from '../../services/token-counter';
import { logUsage, initUsageLogger } from '../../services/usage-logger';
import { apiKeyAuth } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import type { ChatCompletionRequest, ProviderRequest, ProviderError } from '../../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Initialize usage logger on first import
initUsageLogger();

const chatSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.any(),
    tool_calls: z.any().optional(),
    tool_call_id: z.string().optional(),
    name: z.string().optional(),
  })).min(1),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
  response_format: z.any().optional(),
  user: z.string().optional(),
  n: z.number().int().min(1).optional(),
});

// POST /v1/chat/completions
router.post('/chat/completions', apiKeyAuth, rateLimit, async (req: Request, res: Response) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: parsed.error.issues.map(i => i.message).join(', '),
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request',
      },
    });
    return;
  }

  const body = parsed.data as ChatCompletionRequest;
  const startTime = Date.now();
  const requestId = `ocr-${uuidv4().slice(0, 8)}`;

  let effectiveModelId = body.model;

  try {
    let entries;
    (body as any)._effectiveModelId = effectiveModelId;
    try {
      entries = resolveRoute(body.model);
    } catch (err: any) {
      if (err instanceof AutoRouteRequiredError) {
        const strategy = err.strategy as RoutingStrategy;
        const result = autoRoute(body, strategy);
        if (!result.selectedModelId) {
          res.status(422).json({ error: { message: 'No models available for auto-routing', type: 'invalid_request_error' } });
          return;
        }
        (body as any)._effectiveModelId = effectiveModelId;
        entries = resolveRouteWithFallbacks([result.selectedModelId, ...result.fallbackModelIds]);
      } else {
        throw err;
      }
    }

    if (body.stream) {
      return await handleStreaming(req, res, body, entries, requestId, startTime);
    }

    return await handleNonStreaming(req, res, body, entries, requestId, startTime);
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;

    // Log error usage
    logUsage({
      userId: req.userId!,
      apiKeyId: req.apiKeyId || null,
      modelId: effectiveModelId,
      providerId: '',
      providerName: '',
      providerModelId: effectiveModelId,
      requestId,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
      latencyMs,
      ttftMs: null,
      status: 'error',
      errorMessage: err.message || String(err),
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    if (err.retryable !== undefined) {
      res.status(err.status || 502).json({
        error: {
          message: err.message || 'Provider error',
          type: 'upstream_error',
          param: null,
          code: err.code || null,
        },
      });
      return;
    }

    res.status(404).json({
      error: {
        message: err.message || `Model not found: ${effectiveModelId}`,
        type: 'invalid_request_error',
        param: null,
        code: 'model_not_found',
      },
    });
  }
});

async function handleNonStreaming(
  req: Request,
  res: Response,
  body: ChatCompletionRequest,
  entries: any[],
  requestId: string,
  startTime: number,
): Promise<void> {
  const errors: ProviderError[] = [];
  const eid = (body as any)._effectiveModelId || body.model;
  let lastFailedEntry = entries[0];

  for (const entry of entries) {
    const provider = createProvider(entry.providerConfig);
    const providerRequest: ProviderRequest = {
      model: entry.providerModelId,
      messages: body.messages as any,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      stop: Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : undefined,
      tools: body.tools,
      response_format: body.response_format,
      user: body.user,
    };

    try {
      const response = await provider.chat(providerRequest);
      const usage = normalizeUsage(response.usage);
      const latencyMs = Date.now() - startTime;

      // Look up model for pricing
      const model = resolveModel(eid);
      const costCents = model ? toCents(calculateCost(usage, model)) : 0;

      // Billing
      if (model && req.userId) {
        deductUsage(req.userId!, usage, model);
      }

      // Log usage
      logUsage({
        userId: req.userId!,
        apiKeyId: req.apiKeyId || null,
        modelId: eid,
        providerId: entry.providerConfig.id,
        providerName: entry.providerConfig.name,
        providerModelId: entry.providerModelId,
        requestId,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        costCents,
        latencyMs,
        ttftMs: latencyMs,
        status: 'success',
        errorMessage: null,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });

      // Return OpenAI-compatible response
      res.json({
        id: response.id || requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: response.choices.map(c => ({
          index: c.index,
          message: c.message,
          finish_reason: c.finish_reason,
        })),
        usage,
      });
      return;
    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : String(err);
      const pe: ProviderError = err?.retryable !== undefined ? err : {
        status: typeof err?.status === 'number' ? err.status : 500,
        message,
        retryable: false,
      };
      errors.push(pe);
      lastFailedEntry = entry;
      if (!pe.retryable) break;
    }
  }

  // All providers failed
  res.status(502).json({
    error: {
      message: `All providers failed: ${errors.map(e => String(e.message || e)).join('; ')}`,
      type: 'upstream_error',
      param: null,
      code: 'all_providers_failed',
    },
  });

  logUsage({
    userId: req.userId!,
    apiKeyId: req.apiKeyId || null,
    modelId: eid,
    providerId: lastFailedEntry?.providerConfig?.id || '',
    providerName: lastFailedEntry?.providerConfig?.name || '',
    providerModelId: lastFailedEntry?.providerModelId || eid,
    requestId,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costCents: 0,
    latencyMs: Date.now() - startTime,
    ttftMs: null,
    status: 'error',
    errorMessage: errors.map(e => String(e.message || e)).join('; '),
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  });
}

async function handleStreaming(
  req: Request,
  res: Response,
  body: ChatCompletionRequest,
  entries: any[],
  requestId: string,
  startTime: number,
): Promise<void> {
  const eid = (body as any)._effectiveModelId || body.model;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Keepalive ping — prevents intermediaries (nginx, LB) from closing idle connection
  const pingInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, 5_000);

  // AbortController for client disconnect (ESC / connection close)
  const clientAbort = new AbortController();
  let clientDisconnected = false;

  const onClientClose = () => {
    clientDisconnected = true;
    clientAbort.abort();
  };
  // Use res 'close' instead of req 'close' — only fires when connection
  // is closed BEFORE response.end(), avoiding false positives in Node.js v22
  res.on('close', onClientClose);

  // Cleanup helper
  const cleanup = () => {
    res.off('close', onClientClose);
    clearInterval(pingInterval);
  };

  const errors: ProviderError[] = [];
  let lastFailedEntry = entries[0]; // Track the provider that actually failed

  try {
    let ttftMs: number | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const provider = createProvider(entry.providerConfig);
      const providerRequest: ProviderRequest = {
        model: entry.providerModelId,
        messages: body.messages as any,
        temperature: body.temperature,
        top_p: body.top_p,
        max_tokens: body.max_tokens,
        stop: Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : undefined,
        stream: true,
        tools: body.tools,
        response_format: body.response_format,
        user: body.user,
      };

      try {
        const providerStream = provider.chatStream(providerRequest, clientAbort.signal);
        let totalUsage = emptyUsage();
        let streamFinished = false;
        let hasContent = false; // Track if any meaningful chunk was written
        let hasToolCalls = false; // Track if tool_call deltas were sent

        // Use Transform stream to convert provider chunks to SSE format
        const { Readable, Transform } = await import('stream');
        const sseTransform = new Transform({
          objectMode: true,
          transform(chunk: any, _encoding, callback) {
            if (chunk.usage && isUsageValid(chunk.usage)) totalUsage = chunk.usage;
            if (chunk.choices?.[0]?.finish_reason) streamFinished = true;

            // Capture TTFT on first chunk with any output (content, thinking, tool_calls)
            const delta = chunk.choices?.[0]?.delta;
            if (ttftMs === null && delta && (delta.content || delta.thinking || delta.tool_calls)) {
              ttftMs = Date.now() - startTime;
            }

            // Mark as having content if there's any delta payload (even empty role-only chunks count)
            if (delta && (delta.content || delta.thinking || delta.tool_calls || delta.role)) {
              hasContent = true;
            }
            if (delta?.tool_calls?.length) {
              hasToolCalls = true;
            }

            const sseData = `data: ${JSON.stringify({
              id: chunk.id || requestId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: eid,
              choices: chunk.choices,
              ...(chunk.usage ? { usage: chunk.usage } : {}),
            })}\n\n`;
            callback(null, sseData);
          },
          flush(callback) {
            // Only write [DONE] if stream produced meaningful content
            if (hasContent || streamFinished) {
              callback(null, 'data: [DONE]\n\n');
            } else {
              callback();
            }
          },
        });

        const readable = Readable.from(providerStream, { objectMode: true });
        readable.on('error', (err) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: { message: String(err.message || err), type: 'upstream_error', code: 'stream_error' } })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }
        });
        readable.pipe(sseTransform).pipe(res, { end: false });

        await new Promise<void>((resolve, reject) => {
          sseTransform.on('error', reject);
          sseTransform.on('end', resolve);
        });

        const wasCancelled = clientDisconnected;
        let status: 'success' | 'cancelled' | 'error';
        let errorMessage: string | null = null;

        if (wasCancelled && !streamFinished) {
          status = 'cancelled';
          errorMessage = 'Client disconnected';
        } else if (!streamFinished && !hasContent) {
          // Empty stream — no content was sent to client, safe to retry with next provider
          const latencyMs = Date.now() - startTime;
          const model = resolveModel(eid);
          if (model && req.userId && totalUsage.total_tokens > 0) {
            deductUsage(req.userId!, totalUsage, model);
          }
          logUsage({
            userId: req.userId!, apiKeyId: req.apiKeyId || null,
            modelId: eid, providerId: entry.providerConfig.id,
            providerName: entry.providerConfig.name,
            providerModelId: entry.providerModelId, requestId,
            inputTokens: totalUsage.prompt_tokens, outputTokens: totalUsage.completion_tokens,
            totalTokens: totalUsage.total_tokens,
            costCents: model ? toCents(calculateCost(totalUsage, model)) : 0,
            latencyMs, ttftMs,
            status: 'error',
            errorMessage: 'Stream ended without finish_reason',
            ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
          });
          // Throw retryable error to trigger fallback
          const pe = new Error('Stream ended without finish_reason') as Error & ProviderError;
          pe.status = 502;
          pe.retryable = true;
          pe.code = 'empty_stream';
          throw pe;
        } else if (!streamFinished) {
          status = 'error';
          errorMessage = 'Stream ended without finish_reason';
        } else if (totalUsage.total_tokens === 0) {
          status = 'error';
          errorMessage = 'Stream completed but provider returned no usage data';
        } else {
          status = 'success';
        }

        // Write [DONE] for non-empty but unfinished streams (hasContent but !streamFinished)
        if (!wasCancelled && hasContent && !streamFinished) {
          // Warn client if tool_call arguments were truncated
          if (hasToolCalls) {
            res.write(`data: ${JSON.stringify({ error: { message: 'Tool call arguments truncated due to incomplete stream', type: 'upstream_error', code: 'tool_call_truncated' } })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
        }

        const latencyMs = Date.now() - startTime;
        const model = resolveModel(eid);
        const costCents = model ? toCents(calculateCost(totalUsage, model)) : 0;

        if (!wasCancelled) {
          res.end();
        }

        if (status === 'cancelled' || status === 'error') {
          if (model && req.userId && totalUsage.total_tokens > 0) {
            deductUsage(req.userId!, totalUsage, model);
          }
          logUsage({
            userId: req.userId!, apiKeyId: req.apiKeyId || null,
            modelId: eid, providerId: entry.providerConfig.id,
            providerName: entry.providerConfig.name,
            providerModelId: entry.providerModelId, requestId,
            inputTokens: totalUsage.prompt_tokens, outputTokens: totalUsage.completion_tokens,
            totalTokens: totalUsage.total_tokens, costCents, latencyMs, ttftMs,
            status, errorMessage,
            ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
          });
          cleanup();
          return;
        }

        if (model && req.userId) {
          deductUsage(req.userId!, totalUsage, model);
        }
        logUsage({
          userId: req.userId!, apiKeyId: req.apiKeyId || null,
          modelId: eid, providerId: entry.providerConfig.id,
          providerName: entry.providerConfig.name,
          providerModelId: entry.providerModelId, requestId,
          inputTokens: totalUsage.prompt_tokens, outputTokens: totalUsage.completion_tokens,
          totalTokens: totalUsage.total_tokens, costCents, latencyMs, ttftMs,
          status, errorMessage,
          ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
        });
        cleanup();
        return;
      } catch (err: any) {
        // If client disconnected, stop retrying
        if (clientDisconnected) break;

        const message = typeof err?.message === 'string' ? err.message : String(err);
        const pe: ProviderError = err?.retryable !== undefined ? err : {
          status: typeof err?.status === 'number' ? err.status : 500,
          message,
          retryable: false,
        };
        errors.push(pe);
        lastFailedEntry = entry;

        if (pe.retryable && i < entries.length - 1) {
          res.write(`: Retrying with next provider...\n\n`);
          continue;
        }
        // Send timeout error to client immediately instead of hanging
        if (pe.code === 'upstream_timeout') {
          res.write(`data: ${JSON.stringify({ error: { message: `Upstream provider connection timed out`, type: 'upstream_error', code: 'upstream_timeout' } })}\n\n`);
        }
        break;
      }
    }

    // All providers failed
    const errorData = {
      error: {
        message: `All providers failed: ${errors.map(e => String(e.message || e)).join('; ')}`,
        type: 'upstream_error',
        code: 'all_providers_failed',
      },
    };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    const latencyMs = Date.now() - startTime;
    logUsage({
      userId: req.userId!,
      apiKeyId: req.apiKeyId || null,
      modelId: eid,
      providerId: lastFailedEntry?.providerConfig?.id || '',
      providerName: lastFailedEntry?.providerConfig?.name || '',
      providerModelId: lastFailedEntry?.providerModelId || eid,
      requestId,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
      latencyMs,
      ttftMs: null,
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
