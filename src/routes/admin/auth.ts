import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { adminAuth, generateAdminToken } from '../../middleware/admin-auth';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /admin/login
router.post('/login', (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Invalid request', type: 'validation_error' } });
    return;
  }

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(parsed.data.username) as any;
  if (!admin) {
    res.status(401).json({ error: { message: 'Invalid credentials', type: 'auth_error' } });
    return;
  }

  const valid = bcrypt.compareSync(parsed.data.password, admin.password_hash);
  if (!valid) {
    res.status(401).json({ error: { message: 'Invalid credentials', type: 'auth_error' } });
    return;
  }

  const token = generateAdminToken(admin.id, admin.username);
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24h
  });

  res.json({
    success: true,
    admin: { id: admin.id, username: admin.username, display_name: admin.display_name },
  });
});

// GET /admin/me
router.get('/me', adminAuth, (_req: Request, res: Response) => {
  const db = getDb();
  const admin = db.prepare('SELECT id, username, display_name FROM admins WHERE id = ?').get(_req.adminId) as any;
  res.json({ admin });
});

// GET /admin/logout
router.get('/logout', (_req: Request, res: Response) => {
  res.clearCookie('admin_session', { path: '/' });
  res.json({ success: true });
});

export default router;
