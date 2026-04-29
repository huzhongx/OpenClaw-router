import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection';
import { config } from '../config';

export function generateApiKey(): { raw: string; hash: string; prefix: string; id: string } {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString('hex');
  const raw = `${config.apiKeyPrefix}-${hex}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, Math.min(raw.length, 12));
  const id = uuidv4();
  return { raw, hash, prefix, id };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function createApiKeyForUser(userId: string, name: string = 'default', rateLimitRpm: number = config.defaultRateLimitRpm): { raw: string; id: string } {
  const db = getDb();
  const { raw, hash, prefix, id } = generateApiKey();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, rate_limit_rpm, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
  ).run(id, userId, name, hash, prefix, rateLimitRpm, now);

  return { raw, id };
}

export function validateApiKey(rawKey: string): { userId: string; apiKeyId: string; rateLimitRpm: number } | null {
  const db = getDb();
  const hash = hashApiKey(rawKey);

  const apiKey = db.prepare(
    'SELECT ak.*, u.is_active as user_active FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ? AND ak.is_active = 1'
  ).get(hash) as any;

  if (!apiKey) return null;
  if (!apiKey.user_active) return null;
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return null;

  // Update last_used_at (fire-and-forget via a separate prepared statement)
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now, apiKey.id);

  return {
    userId: apiKey.user_id,
    apiKeyId: apiKey.id,
    rateLimitRpm: apiKey.rate_limit_rpm,
  };
}
