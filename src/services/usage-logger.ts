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
  costCents: number;
  latencyMs: number;
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
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const stmt = db.prepare(`
      INSERT INTO usage_logs (id, user_id, api_key_id, model_id, provider_id, provider_name, provider_model_id,
        request_id, input_tokens, output_tokens, total_tokens, cost_cents, latency_ms,
        status, error_message, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((records: typeof batch) => {
      for (const r of records) {
        stmt.run(
          r.id, r.userId, r.apiKeyId, r.modelId, r.providerId, r.providerName, r.providerModelId,
          r.requestId, r.inputTokens, r.outputTokens, r.totalTokens, r.costCents, r.latencyMs,
          r.status, r.errorMessage, r.ipAddress, r.userAgent, now
        );
      }
    });

    insertMany(batch);
  } catch (err) {
    console.error('Failed to flush usage logs:', err);
    // Re-queue on failure (limit to prevent unbounded growth)
    if (queue.length < 1000) {
      queue.push(...batch);
    }
  }
}
