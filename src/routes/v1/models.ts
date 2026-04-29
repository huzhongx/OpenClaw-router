import { Router, Response } from 'express';
import { listActiveModels } from '../../providers/router';
import { apiKeyAuth } from '../../middleware/auth';

const router = Router();

// GET /v1/models
router.get('/models', apiKeyAuth, (_req: any, res: Response) => {
  const models = listActiveModels();

  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.model_id,
      object: 'model',
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: (m as any).provider_name || 'openclaw',
      permission: [],
      root: m.model_id,
      parent: null,
    })),
  });
});

export default router;
