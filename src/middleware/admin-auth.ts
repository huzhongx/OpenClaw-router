import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDb } from '../db/connection';

export interface AdminJwtPayload {
  adminId: number;
  username: string;
}

export function generateAdminToken(adminId: number, username: string): string {
  return jwt.sign({ adminId, username }, config.adminJwtSecret, {
    expiresIn: '24h',
  });
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.admin_session;
  if (!token) {
    res.status(401).json({ error: { message: 'Not authenticated', type: 'auth_error' } });
    return;
  }

  try {
    const payload = jwt.verify(token, config.adminJwtSecret) as AdminJwtPayload;
    const db = getDb();
    const admin = db.prepare('SELECT id, username, display_name FROM admins WHERE id = ?').get(payload.adminId) as any;
    if (!admin) {
      res.status(401).json({ error: { message: 'Admin not found', type: 'auth_error' } });
      return;
    }
    req.adminId = admin.id;
    req.adminUsername = admin.username;
    next();
  } catch {
    res.status(401).json({ error: { message: 'Invalid or expired token', type: 'auth_error' } });
  }
}
