import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';
import { createProvider } from '../../providers/registry';

const router = Router();
router.use(adminAuth);

// GET /admin/providers
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers ORDER BY priority ASC, name ASC').all() as any[];
  // Mask API keys
  const masked = providers.map(p => ({
    ...p,
    api_key_masked: p.api_key ? `${p.api_key.slice(0, 8)}...${p.api_key.slice(-4)}` : null,
    api_key: undefined,
  }));
  res.json({ providers: masked });
});

// POST /admin/providers
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, type, base_url, api_key, priority, timeout_ms, max_retries, config_json } = req.body;
  if (!name || !type || !base_url) {
    res.status(400).json({ error: { message: 'name, type, and base_url are required' } });
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = uuidv4();
  try {
    db.prepare(
      'INSERT INTO providers (id, name, type, base_url, api_key, is_active, priority, timeout_ms, max_retries, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, type, base_url, api_key || null, priority || 0, timeout_ms || 30000, max_retries || 1, config_json ? JSON.stringify(config_json) : null, now, now);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: { message: 'Provider name already exists' } });
      return;
    }
    throw err;
  }

  res.json({ success: true, id, name });
});

// PUT /admin/providers/:id
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { name, type, base_url, api_key, is_active, priority, timeout_ms, max_retries, config_json } = req.body;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id) as any;
  if (!provider) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }

  // Build SET clauses dynamically to avoid COALESCE/CASE parameter count issues
  const sets: string[] = [];
  const params: any[] = [];

  if (name != null) { sets.push('name = ?'); params.push(name); }
  if (type != null) { sets.push('type = ?'); params.push(type); }
  if (base_url != null) { sets.push('base_url = ?'); params.push(base_url); }
  if (api_key != null) { sets.push('api_key = ?'); params.push(api_key); }
  if (is_active != null) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (priority != null) { sets.push('priority = ?'); params.push(priority); }
  if (timeout_ms != null) { sets.push('timeout_ms = ?'); params.push(timeout_ms); }
  if (max_retries != null) { sets.push('max_retries = ?'); params.push(max_retries); }
  if (config_json != null) { sets.push('config_json = ?'); params.push(typeof config_json === 'string' ? config_json : JSON.stringify(config_json)); }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id as string);

    db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ success: true });
});

// DELETE /admin/providers/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /admin/providers/:id/test
router.post('/:id/test', async (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }

  let apiKey = row.api_key || '';
  const envKey = process.env[`PROVIDER_${row.name.toUpperCase()}_API_KEY`];
  if (envKey) apiKey = envKey;
  if (row.type === 'openai' && process.env.OPENAI_API_KEY) apiKey = process.env.OPENAI_API_KEY;
  if (row.type === 'anthropic' && process.env.ANTHROPIC_API_KEY) apiKey = process.env.ANTHROPIC_API_KEY;
  if (row.type === 'gemini' && process.env.GEMINI_API_KEY) apiKey = process.env.GEMINI_API_KEY;

  let extra: Record<string, any> = {};
  if (row.config_json) {
    try { extra = JSON.parse(row.config_json); } catch { /* ignore */ }
  }

  try {
    const provider = createProvider({
      id: row.id,
      name: row.name,
      type: row.type,
      baseUrl: row.base_url,
      apiKey,
      timeoutMs: 10000,
      maxRetries: 0,
      extra,
    });

    const ok = await provider.testConnection();
    res.json({ success: ok, message: ok ? 'Connection successful' : 'Connection failed' });
  } catch (err: any) {
    res.json({ success: false, message: err.message });
  }
});

export default router;
