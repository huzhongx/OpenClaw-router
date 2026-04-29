import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection';
import type { TokenUsage, ModelRow } from '../types';

export function calculateCost(usage: TokenUsage, model: ModelRow): number {
  const inputCost = (usage.prompt_tokens * model.input_price_per_1k) / 1000;
  const outputCost = (usage.completion_tokens * model.output_price_per_1k) / 1000;
  return inputCost + outputCost;
}

export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function deductUsage(userId: string, usage: TokenUsage, model: ModelRow): void {
  const db = getDb();
  const costCents = toCents(calculateCost(usage, model));
  if (costCents === 0) return;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.transaction(() => {
    const user = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(userId) as any;
    if (!user) return;

    const newBalance = user.balance_cents - costCents;
    db.prepare('UPDATE users SET balance_cents = ?, updated_at = ? WHERE id = ?')
      .run(newBalance, now, userId);

    db.prepare(
      'INSERT INTO balance_transactions (id, user_id, amount_cents, balance_after_cents, type, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      uuidv4(),
      userId,
      -costCents,
      newBalance,
      'usage',
      `${model.model_id}: ${usage.total_tokens} tokens`,
      now
    );
  })();
}

export function topUp(userId: string, amountCents: number, description: string = 'Admin top-up'): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.transaction(() => {
    const user = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(userId) as any;
    if (!user) return;

    const newBalance = user.balance_cents + amountCents;
    db.prepare('UPDATE users SET balance_cents = ?, updated_at = ? WHERE id = ?')
      .run(newBalance, now, userId);

    db.prepare(
      'INSERT INTO balance_transactions (id, user_id, amount_cents, balance_after_cents, type, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, amountCents, newBalance, 'topup', description, now);
  })();
}

export function getBalance(userId: string): { balance_cents: number } {
  const db = getDb();
  const user = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(userId) as any;
  return user ? { balance_cents: user.balance_cents } : { balance_cents: 0 };
}
