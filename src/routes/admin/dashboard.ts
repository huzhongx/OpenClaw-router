import { Router, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// Build parameterized provider filter conditions
function buildProviderFilter(provider: string) {
  if (!provider) return { sql: '', params: [] as any[] };
  return { sql: ' AND provider_name = ?', params: [provider] as any[] };
}

// Build parameterized user filter conditions
function buildUserFilter(userId: string) {
  if (!userId) return { sql: '', params: [] as any[] };
  return { sql: ' AND user_id = ?', params: [userId] as any[] };
}

function buildFilters(provider: string, userId: string) {
  const pf = buildProviderFilter(provider);
  const uf = buildUserFilter(userId);
  return {
    sql: pf.sql + uf.sql,
    params: [...pf.params, ...uf.params],
  };
}

// GET /admin/dashboard/stats?range=today|7d|30d&provider=xxx&user_id=xxx
router.get('/stats', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';
  const { sql: f, params: fParams } = buildFilters(_req.query.provider as string || '', _req.query.user_id as string || '');

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const activeKeys = (db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c;
  const totalRequests = (db.prepare(`SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success'${f}`).get(...fParams) as any).c;
  const totalCostCents = (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE status = 'success'${f}`).get(...fParams) as any).c;

  let whereClause: string;
  if (range === '7d') {
    whereClause = "created_at >= datetime('now', '-7 days')";
  } else if (range === '30d') {
    whereClause = "created_at >= datetime('now', '-30 days')";
  } else {
    whereClause = "date(created_at, '+8 hours') = date('now', '+8 hours')";
  }

  const rangeWhere = `status = 'success' AND ${whereClause}${f}`;
  const rangeRequests = (db.prepare(`SELECT COUNT(*) as c FROM usage_logs WHERE ${rangeWhere}`).get(...fParams) as any).c;
  const rangeCostCents = (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) as c FROM usage_logs WHERE ${rangeWhere}`).get(...fParams) as any).c;
  const rangeTokens = (db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) as c FROM usage_logs WHERE ${rangeWhere}`).get(...fParams) as any).c;

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

// GET /admin/dashboard/daily-usage?days=30&provider=xxx&user_id=xxx
router.get('/daily-usage', (_req: any, res: Response) => {
  const db = getDb();
  const days = Math.min(Math.max(parseInt(_req.query.days as string) || 30, 1), 365);
  const { sql: f, params: fParams } = buildFilters(_req.query.provider as string || '', _req.query.user_id as string || '');

  const rows = db.prepare(`
    SELECT date(created_at, '+8 hours') as date,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE created_at >= datetime('now', '-${days} days')${f}
    GROUP BY date(created_at, '+8 hours')
    ORDER BY date(created_at, '+8 hours')
  `).all(...fParams) as any[];

  res.json({ days: rows });
});

// GET /admin/dashboard/hourly-usage?provider=xxx&user_id=xxx
router.get('/hourly-usage', (_req: any, res: Response) => {
  const db = getDb();
  const { sql: f, params: fParams } = buildFilters(_req.query.provider as string || '', _req.query.user_id as string || '');

  const rows = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', created_at, '+8 hours') as hour,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(cost_cents) as cost_cents,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM usage_logs
    WHERE date(created_at, '+8 hours') = date('now', '+8 hours')${f}
    GROUP BY strftime('%Y-%m-%d %H', created_at, '+8 hours')
    ORDER BY hour
  `).all(...fParams) as any[];

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
    whereClause = "date(ul.created_at, '+8 hours') = date('now', '+8 hours')";
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

// GET /admin/dashboard/provider-stats?range=today|7d|30d
router.get('/provider-stats', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';

  let whereClause: string;
  if (range === '7d') {
    whereClause = "created_at >= datetime('now', '-7 days')";
  } else if (range === '30d') {
    whereClause = "created_at >= datetime('now', '-30 days')";
  } else {
    whereClause = "date(created_at, '+8 hours') = date('now', '+8 hours')";
  }

  // Aggregate stats per provider
  const rows = db.prepare(`
    SELECT provider_name,
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      COALESCE(SUM(cost_cents), 0) as cost_cents,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      CAST(COALESCE(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 0) AS INTEGER) as avg_latency_ms,
      CAST(COALESCE(AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END), 0) AS INTEGER) as avg_ttft_ms
    FROM usage_logs
    WHERE ${whereClause}
    GROUP BY provider_name
    ORDER BY total_requests DESC
  `).all() as any[];

  // Calculate P50 latency per provider
  const enriched = rows.map((r: any) => {
    let p50Latency: number | null = null;
    let p50Ttft: number | null = null;
    try {
      const latencies = db.prepare(
        `SELECT latency_ms FROM usage_logs WHERE provider_name = ? AND latency_ms IS NOT NULL AND ${whereClause} ORDER BY latency_ms`
      ).all(r.provider_name) as any[];
      if (latencies.length > 0) {
        p50Latency = latencies[Math.floor(latencies.length * 0.5)].latency_ms;
      }
      const ttfts = db.prepare(
        `SELECT ttft_ms FROM usage_logs WHERE provider_name = ? AND ttft_ms IS NOT NULL AND ${whereClause} ORDER BY ttft_ms`
      ).all(r.provider_name) as any[];
      if (ttfts.length > 0) {
        p50Ttft = ttfts[Math.floor(ttfts.length * 0.5)].ttft_ms;
      }
    } catch { /* ignore */ }

    return {
      ...r,
      success_rate: r.total_requests > 0 ? Math.round(r.success_count / r.total_requests * 100) : 0,
      p50_latency_ms: p50Latency,
      p50_ttft_ms: p50Ttft,
      cost_usd: (r.cost_cents / 100).toFixed(2),
    };
  });

  res.json({ providers: enriched });
});

// GET /admin/dashboard/provider-timeseries?range=today|7d|30d
router.get('/provider-timeseries', (_req: any, res: Response) => {
  const db = getDb();
  const range = _req.query.range as string || 'today';

  let whereClause: string;
  let groupExpr: string;
  if (range === '7d') {
    whereClause = "created_at >= datetime('now', '-7 days')";
    groupExpr = "date(created_at, '+8 hours')";
  } else if (range === '30d') {
    whereClause = "created_at >= datetime('now', '-30 days')";
    groupExpr = "date(created_at, '+8 hours')";
  } else {
    whereClause = "created_at >= datetime('now', 'start of day', '-8 hours')";
    groupExpr = "strftime('%H', created_at, '+8 hours')";
  }

  const rows = db.prepare(`
    SELECT ${groupExpr} as time_bucket,
      provider_name,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      CAST(COALESCE(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 0) AS INTEGER) as avg_latency_ms,
      CAST(COALESCE(AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END), 0) AS INTEGER) as avg_ttft_ms
    FROM usage_logs
    WHERE ${whereClause} AND provider_name IS NOT NULL AND provider_name != ''
    GROUP BY ${groupExpr}, provider_name
    ORDER BY time_bucket, provider_name
  `).all() as any[];

  res.json({ series: rows });
});

export default router;
