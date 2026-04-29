import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';
import { createApiKeyForUser } from '../../services/key-manager';

const router = Router();
router.use(adminAuth);

// GET /admin/api-keys
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const userId = req.query.user_id as string;

  let where = '';
  const params: any[] = [];
  if (userId) {
    where = 'WHERE ak.user_id = ?';
    params.push(userId);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM api_keys ak ${where}`).get(...params) as any;
  const keys = db.prepare(
    `SELECT ak.*, u.name as user_name, u.email as user_email
     FROM api_keys ak JOIN users u ON ak.user_id = u.id
     ${where} ORDER BY ak.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  res.json({ page, limit, total: total.count, keys });
});

// POST /admin/api-keys
router.post('/', (req: Request, res: Response) => {
  const { user_id, name, rate_limit_rpm } = req.body;
  if (!user_id) {
    res.status(400).json({ error: { message: 'user_id is required' } });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id) as any;
  if (!user) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }

  const { raw, id } = createApiKeyForUser(user_id, name || 'default', rate_limit_rpm || 60);

  res.json({ success: true, api_key: raw, id, prefix: raw.slice(0, 12) });
});

// DELETE /admin/api-keys/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
