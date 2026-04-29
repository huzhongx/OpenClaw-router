import { Router, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// GET /admin/dashboard/stats
router.get('/stats', (_req: any, res: Response) => {
  const db = getDb();

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const activeKeys = (db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c;
  const totalRequests = (db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success'").get() as any).c;
  const totalCostCents = (db.prepare("SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success'").get() as any).c;

  const today = new Date().toISOString().slice(0, 10);
  const requestsToday = (db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success' AND date(created_at) = ?").get(today) as any).c;
  const costTodayCents = (db.prepare("SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success' AND date(created_at) = ?").get(today) as any).c;

  res.json({
    total_users: totalUsers,
    active_keys: activeKeys,
    total_requests: totalRequests,
    total_cost_cents: totalCostCents,
    total_cost_usd: (totalCostCents / 100).toFixed(2),
    requests_today: requestsToday,
    cost_today_cents: costTodayCents,
    cost_today_usd: (costTodayCents / 100).toFixed(2),
  });
});

// GET /admin/dashboard/daily-usage
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

export default router;
