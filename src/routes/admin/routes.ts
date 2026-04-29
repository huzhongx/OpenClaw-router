import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const router = Router();
router.use(adminAuth);

// GET /admin/routes
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const routes = db.prepare('SELECT * FROM routes ORDER BY model_id').all() as any[];

  const result = routes.map(r => {
    const entries = db.prepare(
      'SELECT re.*, p.name as provider_name FROM route_entries re JOIN providers p ON re.provider_id = p.id WHERE re.route_id = ? ORDER BY re.priority ASC'
    ).all(r.id) as any[];
    return { ...r, entries };
  });

  res.json({ routes: result });
});

// POST /admin/routes
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { model_id, display_name, strategy, entries } = req.body;
  if (!model_id || !entries?.length) {
    res.status(400).json({ error: { message: 'model_id and entries are required' } });
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = uuidv4();

  const insertRoute = db.prepare(
    'INSERT INTO routes (id, model_id, display_name, strategy, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  );
  const insertEntry = db.prepare(
    'INSERT INTO route_entries (id, route_id, provider_id, provider_model_id, priority, weight, is_active) VALUES (?, ?, ?, ?, ?, 1, 1)'
  );

  const tx = db.transaction(() => {
    insertRoute.run(id, model_id, display_name || model_id, strategy || 'priority', now, now);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      insertEntry.run(uuidv4(), id, e.provider_id, e.provider_model_id, e.priority ?? i, e.weight ?? 1);
    }
  });

  try {
    tx();
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: { message: 'Route for this model_id already exists' } });
      return;
    }
    throw err;
  }

  res.json({ success: true, id });
});

// PUT /admin/routes/:id
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { display_name, strategy, is_active, entries } = req.body;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    'UPDATE routes SET display_name = COALESCE(?, display_name), strategy = COALESCE(?, strategy), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?'
  ).run(display_name || null, strategy || null, is_active !== undefined ? (is_active ? 1 : 0) : null, now, req.params.id);

  // Replace entries if provided
  if (entries && Array.isArray(entries)) {
    db.prepare('DELETE FROM route_entries WHERE route_id = ?').run(req.params.id);
    const insertEntry = db.prepare(
      'INSERT INTO route_entries (id, route_id, provider_id, provider_model_id, priority, weight, is_active) VALUES (?, ?, ?, ?, ?, 1, 1)'
    );
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      insertEntry.run(uuidv4(), req.params.id, e.provider_id, e.provider_model_id, e.priority ?? i, e.weight ?? 1);
    }
  }

  res.json({ success: true });
});

// DELETE /admin/routes/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
