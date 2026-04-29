import { Router, Response } from 'express';
import { getDb } from '../../db/connection';
import { apiKeyAuth } from '../../middleware/auth';

const router = Router();

// GET /user/keys
router.get('/keys', apiKeyAuth, (req: any, res: Response) => {
  const db = getDb();
  const keys = db.prepare(
    'SELECT id, name, key_prefix, rate_limit_rpm, is_active, last_used_at, expires_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.userId) as any[];

  res.json({ keys });
});

export default router;
