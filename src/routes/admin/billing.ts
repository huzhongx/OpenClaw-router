import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// GET /admin/billing/transactions
router.get('/transactions', (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const userId = req.query.user_id as string;
  const type = req.query.type as string;

  const conditions: string[] = [];
  const params: any[] = [];
  if (userId) { conditions.push('bt.user_id = ?'); params.push(userId); }
  if (type) { conditions.push('bt.type = ?'); params.push(type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM balance_transactions bt ${where}`).get(...params) as any;

  const transactions = db.prepare(`
    SELECT bt.*, u.name as user_name, u.email as user_email
    FROM balance_transactions bt
    LEFT JOIN users u ON bt.user_id = u.id
    ${where}
    ORDER BY bt.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  res.json({ page, limit, total: total.count, transactions });
});

export default router;
