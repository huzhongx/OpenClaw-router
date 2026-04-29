import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { apiKeyAuth } from '../../middleware/auth';

const router = Router();

// GET /user/usage
router.get('/usage', apiKeyAuth, (req: any, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ?'
  ).get(req.userId) as any;

  const logs = db.prepare(
    'SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(req.userId, limit, offset) as any[];

  // Summary
  const summary = db.prepare(
    "SELECT COUNT(*) as total_requests, SUM(total_tokens) as total_tokens, SUM(cost_cents) as total_cost_cents FROM usage_logs WHERE user_id = ? AND status = 'success'"
  ).get(req.userId) as any;

  res.json({
    page,
    limit,
    total: total.count,
    total_pages: Math.ceil(total.count / limit),
    summary: {
      total_requests: summary.total_requests || 0,
      total_tokens: summary.total_tokens || 0,
      total_cost_cents: summary.total_cost_cents || 0,
      total_cost_usd: ((summary.total_cost_cents || 0) / 100).toFixed(2),
    },
    logs,
  });
});

export default router;
