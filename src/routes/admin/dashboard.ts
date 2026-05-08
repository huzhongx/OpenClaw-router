import { Router, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

function provFilter(providerName: string) {
  if (!providerName) return '';
  return ` AND provider_name = '${providerName.replace(/'/g, "''")}'`;
}

// GET /admin/dashboard/stats?range=today|7d|30d&provider=xxx
router.get('/stats', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';
  const pf = provFilter(_req.query.provider as string || '');

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const activeKeys = (db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c;
  const totalRequests = (db.prepare(`SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success'${pf}`).get() as any).c;
  const totalCostCents = (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success'${pf}`).get() as any).c;

  let whereClause: string;
  if (range === '7d') {
    whereClause = "created_at >= datetime('now', '-7 days')";
  } else if (range === '30d') {
    whereClause = "created_at >= datetime('now', '-30 days')";
  } else {
    whereClause = "date(created_at) = date('now')";
  }

  const rangeWhere = `status = 'success' AND ${whereClause}${pf}`;
  const rangeRequests = (db.prepare(`SELECT COUNT(*) as c FROM usage_logs WHERE ${rangeWhere}`).get() as any).c;
  const rangeCostCents = (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE ${rangeWhere}`).get() as any).c;
  const rangeTokens = (db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) as c FROM usage_logs WHERE ${rangeWhere}`).get() as any).c;

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

// GET /admin/dashboard/daily-usage?days=30&provider=xxx
router.get('/daily-usage', (_req: any, res: Response) => {
  const db = getDb();
  const days = parseInt(_req.query.days as string) || 30;
  const pf = provFilter(_req.query.provider as string || '');

  const rows = db.prepare(`
    SELECT date(created_at) as date,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE created_at >= datetime('now', '-${days} days')${pf}
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all() as any[];

  res.json({ days: rows });
});

// GET /admin/dashboard/hourly-usage?provider=xxx
router.get('/hourly-usage', (_req: any, res: Response) => {
  const db = getDb();
  const pf = provFilter(_req.query.provider as string || '');

  const rows = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', created_at) as hour,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE date(created_at) = date('now')${pf}
    GROUP BY strftime('%Y-%m-%d %H', created_at)
    ORDER BY hour
  `).all() as any[];

  res.json({ hours: rows });
});

// GET /admin/dashboard/user-stats?range=today|7d|30d
router.get('/user-stats', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';

  let whereClause: string;
  if (range === '7d') {
    whereClause = "ul.created_at >= datetime('now', '-7 days')";
  } else if (range === '30d') {
    whereClause = "ul.created_at >= datetime('now', '-30 days')";
  } else {
    whereClause = "date(ul.created_at) = date('now')";
  }

  const rows = db.prepare(`
    SELECT ul.user_id, u.name as user_name, u.email, u.balance_cents, u.is_active,
      COUNT(*) as requests,
      COALESCE(SUM(ul.total_tokens), 0) as tokens,
      COALESCE(SUM(ul.cost_cents), 0) as cost_cents,
      SUM(CASE WHEN ul.status = 'error' THEN 1 ELSE 0 END) as errors,
      MAX(ul.created_at) as last_active
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ${whereClause}
    GROUP BY ul.user_id
    ORDER BY requests DESC
  `).all() as any[];

  res.json({ users: rows });
});

export default router;
