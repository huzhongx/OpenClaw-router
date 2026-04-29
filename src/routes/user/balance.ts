import { Router, Response } from 'express';
import { getBalance } from '../../services/billing';
import { getDb } from '../../db/connection';
import { apiKeyAuth } from '../../middleware/auth';

const router = Router();

// GET /user/balance
router.get('/balance', apiKeyAuth, (req: any, res: Response) => {
  const balance = getBalance(req.userId!);

  const db = getDb();
  const transactions = db.prepare(
    'SELECT * FROM balance_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(req.userId) as any[];

  res.json({
    balance_cents: balance.balance_cents,
    balance_usd: (balance.balance_cents / 100).toFixed(2),
    recent_transactions: transactions,
  });
});

export default router;
