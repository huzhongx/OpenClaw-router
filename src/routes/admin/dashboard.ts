import { Router, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// GET /admin/dashboard/stats?range=today|7d|30d
router.get('/stats', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const activeKeys = (db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c;
  const totalRequests = (db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success'").get() as any).c;
  const totalCostCents = (db.prepare("SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success'").get() as any).c;

  let whereClause: string;
  if (range === '7d') {
    whereClause = "created_at >= datetime('now', '-7 days')";
  } else if (range === '30d') {
    whereClause = "created_at >= datetime('now', '-30 days')";
  } else {
    whereClause = "date(created_at) = date('now')";
  }

  const rangeRequests = (db.prepare(`SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success' AND ${whereClause}`).get() as any).c;
  const rangeCostCents = (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success' AND ${whereClause}`).get() as any).c;
  const rangeTokens = (db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) as c FROM usage_logs WHERE status = 'success' AND ${whereClause}`).get() as any).c;

  res.json({
    total_users: totalUsers,
    active_keys: activeKeys,
    total_requests: totalRequests,
    total_cost_cents: totalCostCents,
    total_cost_usd: (totalCostCents / 100).toFixed(2),
    range_requests: rangeRequests,
    range_cost_cents: rangeCostCents,
    range_cost_usd: (rangeCostCents / 100).toFixed(2),
    range_tokens: rangeTokens,
  });
});

// GET /admin/dashboard/daily-usage?days=30
router.get('/daily-usage', (_req: any, res: Response) => {
  const db = getDb();
  const days = parseInt(_req.query.days as string) || 30;

  const rows = db.prepare(`
    SELECT date(created_at) as date,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all() as any[];

  res.json({ days: rows });
});

// GET /admin/dashboard/hourly-usage
router.get('/hourly-usage', (_req: any, res: Response) => {
  const db = getDb();

  const rows = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', created_at) as hour,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE date(created_at) = date('now')
    GROUP BY strftime('%Y-%m-%d %H', created_at)
    ORDER BY hour
  `).all() as any[];

  res.json({ hours: rows });
});

export default router;
