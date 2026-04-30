import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// GET /admin/usage
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const modelId = req.query.model_id as string;
  const userId = req.query.user_id as string;
  const status = req.query.status as string;
  const dateFrom = req.query.date_from as string;
  const dateTo = req.query.date_to as string;

  const conditions: string[] = [];
  const params: any[] = [];

  if (modelId) { conditions.push('ul.model_id = ?'); params.push(modelId); }
  if (userId) { conditions.push('ul.user_id = ?'); params.push(userId); }
  if (status) { conditions.push('ul.status = ?'); params.push(status); }
  if (dateFrom) { conditions.push('ul.created_at >= ?'); params.push(dateFrom); }
  if (dateTo) { conditions.push('ul.created_at <= ?'); params.push(dateTo + ' 23:59:59'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM usage_logs ul ${where}`).get(...params) as any;

  const logs = db.prepare(`
    SELECT ul.*, u.name as user_name
    FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    ${where}
    ORDER BY ul.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  res.json({ page, limit, total: total.count, logs });
});

export default router;
