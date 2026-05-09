import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';

const modelPostSchema = z.object({
  model_id: z.string().min(1),
  display_name: z.string().optional(),
  provider_id: z.string().min(1),
  provider_model_id: z.string().min(1),
  input_price_per_1k: z.number().min(0).optional(),
  output_price_per_1k: z.number().min(0).optional(),
  max_tokens: z.number().int().positive().optional(),
  supports_tools: z.boolean().optional(),
  supports_vision: z.boolean().optional(),
  supports_json_mode: z.boolean().optional(),
});

const modelPutSchema = z.object({
  display_name: z.string().optional(),
  provider_id: z.string().min(1).optional(),
  provider_model_id: z.string().min(1).optional(),
  input_price_per_1k: z.number().min(0).optional(),
  output_price_per_1k: z.number().min(0).optional(),
  max_tokens: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  supports_tools: z.boolean().optional(),
  supports_vision: z.boolean().optional(),
  supports_json_mode: z.boolean().optional(),
});

const router = Router();
router.use(adminAuth);

// GET /admin/models
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare(
    'SELECT m.*, p.name as provider_name, p.type as provider_type FROM models m JOIN providers p ON m.provider_id = p.id ORDER BY m.model_id'
  ).all() as any[];
  res.json({ models });
});

// POST /admin/models
router.post('/', (req: Request, res: Response) => {
  const parsed = modelPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
    return;
  }
  const db = getDb();
  const { model_id, display_name, provider_id, provider_model_id, input_price_per_1k, output_price_per_1k, max_tokens, supports_tools, supports_vision, supports_json_mode } = parsed.data;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = uuidv4();
  try {
    db.prepare(
      'INSERT INTO models (id, model_id, display_name, provider_id, provider_model_id, input_price_per_1k, output_price_per_1k, max_tokens, supports_tools, supports_vision, supports_json_mode, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    ).run(id, model_id, display_name || model_id, provider_id, provider_model_id, input_price_per_1k || 0, output_price_per_1k || 0, max_tokens || null, supports_tools ? 1 : 0, supports_vision ? 1 : 0, supports_json_mode ? 1 : 0, now, now);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ error: { message: 'Model ID already exists' } });
      return;
    }
    throw err;
  }

  res.json({ success: true, id, model_id });
});

// PUT /admin/models/:id
router.put('/:id', (req: Request, res: Response) => {
  const parsed = modelPutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
    return;
  }
  const db = getDb();
  const { display_name, provider_id, provider_model_id, input_price_per_1k, output_price_per_1k, max_tokens, is_active, supports_tools, supports_vision, supports_json_mode } = parsed.data;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    `UPDATE models SET
      display_name = COALESCE(?, display_name), provider_id = COALESCE(?, provider_id),
      provider_model_id = COALESCE(?, provider_model_id),
      input_price_per_1k = COALESCE(?, input_price_per_1k), output_price_per_1k = COALESCE(?, output_price_per_1k),
      max_tokens = ?, supports_tools = COALESCE(?, supports_tools),
      supports_vision = COALESCE(?, supports_vision), supports_json_mode = COALESCE(?, supports_json_mode),
      is_active = COALESCE(?, is_active), updated_at = ?
    WHERE id = ?`
  ).run(
    display_name || null, provider_id || null, provider_model_id || null,
    input_price_per_1k ?? null, output_price_per_1k ?? null,
    max_tokens !== undefined ? max_tokens : null,
    supports_tools !== undefined ? (supports_tools ? 1 : 0) : null,
    supports_vision !== undefined ? (supports_vision ? 1 : 0) : null,
    supports_json_mode !== undefined ? (supports_json_mode ? 1 : 0) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    now, req.params.id
  );

  res.json({ success: true });
});

// DELETE /admin/models/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
