import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection';
import type { TokenUsage } from '../types';

interface UsageLogRecord {
  userId: string;
  apiKeyId: string | null;
  modelId: string;
  providerId: string;
  providerName: string;
  providerModelId: string;
  requestId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  // Provider-reported prompt-cache hits. Displayed in dashboard so users
  // can see how much of their input was served from cache (which MiniMax
  // and Anthropic both offer as a discount path). Billing still charges
  // full input_tokens for now — the cache_* fields are diagnostic only.
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costCents: number;
  latencyMs: number;
  ttftMs?: number | null;
  finishReason?: string | null;
  status: string;
  errorMessage: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

let queue: (UsageLogRecord & { id: string })[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL = 5000;
const MAX_QUEUE_SIZE = 100;

export function initUsageLogger(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL);

  // Flush on process exit
  process.on('exit', () => {
    flushSync();
  });
}

export function logUsage(record: UsageLogRecord): void {
  queue.push({ ...record, id: uuidv4() });
  if (queue.length >= MAX_QUEUE_SIZE) {
    flush();
  }
}

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  flushBatch(batch);
}

function flushSync(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  flushBatch(batch);
}

function flushBatch(batch: (UsageLogRecord & { id: string })[]): void {
  try {
    const db = getDb();
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const stmt = db.prepare(`
      INSERT INTO usage_logs (id, user_id, api_key_id, model_id, provider_id, provider_model_id,
        request_id, input_tokens, output_tokens, total_tokens, cost_cents, latency_ms,
        status, error_message, ip_address, user_agent, created_at,
        provider_name, ttft_ms, finish_reason,
        cache_read_input_tokens, cache_creation_input_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Insert one record at a time, no transaction wrapper. better-sqlite3
    // auto-commits each statement, so a single bad row (e.g. orphaned
    // api_key_id after the key was deleted) does not roll back the whole
    // batch. The previous db.transaction() wrapper would silently drop
    // every record in the batch on the first FK failure, leaving the
    // queue in a permanent failure state once any orphan was queued.
    for (const r of batch) {
      try {
        stmt.run(
          r.id, r.userId, r.apiKeyId, r.modelId, r.providerId, r.providerModelId,
          r.requestId, r.inputTokens, r.outputTokens, r.totalTokens, r.costCents, r.latencyMs,
          r.status, r.errorMessage, r.ipAddress, r.userAgent, ts,
          r.providerName, r.ttftMs ?? null, r.finishReason ?? null,
          r.cacheReadInputTokens ?? 0, r.cacheCreationInputTokens ?? 0
        );
      } catch (err: any) {
        console.warn('Dropped usage log row', r.id, '—', err?.code || err?.message || 'unknown');
      }
    }
  } catch (err) {
    console.error('Failed to flush usage logs:', err);
    // Re-queue on failure (limit to prevent unbounded growth)
    if (queue.length < 1000) {
      queue.push(...batch);
    }
  }
}
