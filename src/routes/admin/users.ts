import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';
import { topUp } from '../../services/billing';

const userPostSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  balance_cents: z.number().int().min(0).optional(),
});

const userPutSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')).nullable().optional(),
  is_active: z.boolean().optional(),
});

const topupSchema = z.object({
  amount_cents: z.number().int().refine(v => v !== 0, 'Amount must be non-zero'),
  description: z.string().optional(),
});

const router = Router();
router.use(adminAuth);

// GET /admin/users
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const search = req.query.search as string || '';

  let where = '';
  const params: any[] = [];
  if (search) {
    where = 'WHERE u.name LIKE ? OR u.email LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM users u ${where}`).get(...params) as any;
  const users = db.prepare(
    `SELECT u.id, u.name, u.email, u.balance_cents, u.is_active, u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id AND is_active = 1) as active_keys
     FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  res.json({ page, limit, total: total.count, users });
});

// POST /admin/users
router.post('/', (req: Request, res: Response) => {
  const parsed = userPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
    return;
  }
  const db = getDb();
  const { name, email, balance_cents } = parsed.data;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = uuidv4();
  const initialBalance = balance_cents || 0;

  try {
    db.prepare('INSERT INTO users (id, name, email, balance_cents, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(id, name, email || null, initialBalance, now, now);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: { message: 'Email already exists' } });
      return;
    }
    throw err;
  }

  res.json({ success: true, user: { id, name, email: email || null, balance_cents: initialBalance } });
});

// PUT /admin/users/:id
router.put('/:id', (req: Request, res: Response) => {
  const parsed = userPutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
    return;
  }
  const db = getDb();
  const { name, email, is_active } = parsed.data;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }

  db.prepare('UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?')
    .run(name || null, email !== undefined ? email : null, is_active !== undefined ? (is_active ? 1 : 0) : null, now, req.params.id);

  res.json({ success: true });
});

// POST /admin/users/:id/topup
router.post('/:id/topup', (req: Request, res: Response) => {
  const parsed = topupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
    return;
  }
  const { amount_cents: amountCents, description } = parsed.data;

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }

  topUp(req.params.id as string, amountCents as number, description || 'Admin top-up');
  const balance = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(req.params.id as string) as any;

  res.json({ success: true, balance_cents: balance.balance_cents });
});

export default router;
