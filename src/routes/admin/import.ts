import { Router, Request, Response } from 'express';
import { adminAuth } from '../../middleware/admin-auth';
import { importLiteLLMModels, previewLiteLLMImport } from '../../services/litellm-import';

const router = Router();
router.use(adminAuth);

// GET /admin/import/litellm/preview — preview what would be imported
router.get('/litellm/preview', async (req: Request, res: Response) => {
  try {
    const providerFilter = req.query.providers
      ? String(req.query.providers).split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const result = await previewLiteLLMImport(providerFilter);
    res.json({
      total: result.total,
      preview: result.models.map(m => ({
        model_id: m.modelId,
        display_name: m.displayName,
        provider: m.providerName,
        input_price_per_1k: m.inputPricePer1k,
        output_price_per_1k: m.outputPricePer1k,
        max_tokens: m.maxTokens,
        supports_tools: m.supportsTools,
        supports_vision: m.supportsVision,
        supports_json_mode: m.supportsJsonMode,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to preview LiteLLM import' } });
  }
});

// POST /admin/import/litellm — trigger import
router.post('/litellm', async (req: Request, res: Response) => {
  try {
    const { providers, overwrite } = req.body;
    const result = await importLiteLLMModels({
      providers: Array.isArray(providers) ? providers : undefined,
      overwrite: !!overwrite,
    });

    if (!result.success) {
      res.status(500).json({ error: { message: result.error || 'Import failed' } });
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to import from LiteLLM' } });
  }
});

export default router;
