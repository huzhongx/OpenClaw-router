import type { ScoredModel } from '../types';
import { getDb } from '../db/connection';

// Static quality scores from Artificial Analysis benchmarks (0-100 scale)
const STATIC_QUALITY_SCORES: Record<string, number> = {
  // OpenAI
  'gpt-4o': 86, 'gpt-4o-mini': 72, 'gpt-4.1': 88, 'gpt-4.1-mini': 75, 'gpt-4.1-nano': 68,
  'o1': 90, 'o1-mini': 82, 'o3': 93, 'o3-mini': 84, 'o4-mini': 86,
  // Anthropic
  'claude-opus-4-20250514': 91, 'claude-sonnet-4-20250514': 88,
  'claude-haiku-4-5-20251001': 76,
  'claude-3-5-sonnet-20241022': 85, 'claude-3-5-haiku-20241022': 73,
  'claude-3-opus-20240229': 87,
  // Google
  'gemini-2.5-pro': 89, 'gemini-2.5-flash': 78, 'gemini-2.0-flash': 74,
  'gemini-2.5-flash-lite': 68,
  // Mistral
  'mistral-large': 80, 'mistral-small': 70, 'codestral': 76,
  // DeepSeek
  'deepseek-chat': 76, 'deepseek-reasoner': 83,
  // Meta (via compatible providers)
  'llama-3.3-70b': 74, 'llama-3.1-405b': 77,
};

const DEFAULT_SCORE = 50;

export function getQualityScore(modelId: string): number {
  const db = getDb();
  const override = db.prepare('SELECT quality_score FROM quality_score_overrides WHERE model_id = ?').get(modelId) as { quality_score: number } | undefined;
  if (override) return override.quality_score;
  return STATIC_QUALITY_SCORES[modelId] ?? DEFAULT_SCORE;
}

export function getAllQualityScores(): Array<{
  model_id: string;
  static_score: number;
  override_score: number | null;
  effective_score: number;
  notes: string | null;
}> {
  const db = getDb();
  const models = db.prepare('SELECT model_id FROM models WHERE is_active = 1 ORDER BY model_id').all() as Array<{ model_id: string }>;
  const overrides = db.prepare('SELECT * FROM quality_score_overrides').all() as Array<{ model_id: string; quality_score: number; notes: string | null }>;
  const overrideMap = new Map(overrides.map(o => [o.model_id, o]));
  return models.map(m => {
    const override = overrideMap.get(m.model_id);
    return {
      model_id: m.model_id,
      static_score: STATIC_QUALITY_SCORES[m.model_id] ?? DEFAULT_SCORE,
      override_score: override?.quality_score ?? null,
      effective_score: getQualityScore(m.model_id),
      notes: override?.notes ?? null,
    };
  });
}

export function setQualityOverride(modelId: string, score: number, notes?: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const existing = db.prepare('SELECT id FROM quality_score_overrides WHERE model_id = ?').get(modelId) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE quality_score_overrides SET quality_score = ?, notes = ?, updated_at = ? WHERE id = ?').run(score, notes ?? null, now, existing.id);
  } else {
    db.prepare('INSERT INTO quality_score_overrides (id, model_id, quality_score, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), modelId, score, notes ?? null, now, now);
  }
}

export function deleteQualityOverride(modelId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM quality_score_overrides WHERE model_id = ?').run(modelId);
  return result.changes > 0;
}

export function getLatencyP50(modelId: string, providerId: string): number | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT latency_ms FROM usage_logs
    WHERE model_id = ? AND provider_id = ? AND status = 'success' AND latency_ms IS NOT NULL AND latency_ms > 0
    ORDER BY latency_ms
    LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM usage_logs WHERE model_id = ? AND provider_id = ? AND status = 'success' AND latency_ms IS NOT NULL AND latency_ms > 0)
  `).get(modelId, providerId, modelId, providerId) as { latency_ms: number } | undefined;
  return row?.latency_ms ?? null;
}
