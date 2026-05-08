import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';
import { getDefaultStrategy, isAutoRoutingEnabled, getScoredModels, rankByStrategy, filterByCapabilities } from '../../services/auto-routing';
import type { RoutingStrategy, DetectedCapabilities } from '../../types';

const router = Router();
router.use(adminAuth);

const VALID_STRATEGIES: RoutingStrategy[] = ['priority', 'cheapest', 'quality', 'balanced', 'fastest'];

router.get('/config', (_req: Request, res: Response) => {
  res.json({ default_strategy: getDefaultStrategy(), auto_enabled: isAutoRoutingEnabled(), available_strategies: VALID_STRATEGIES });
});

router.put('/config', (req: Request, res: Response) => {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (req.body.default_strategy !== undefined) {
    if (!VALID_STRATEGIES.includes(req.body.default_strategy)) {
      res.status(400).json({ error: { message: `Invalid strategy: ${req.body.default_strategy}` } });
      return;
    }
    db.prepare("UPDATE routing_config SET value = ?, updated_at = ? WHERE key = 'default_strategy'").run(req.body.default_strategy, now);
  }
  if (req.body.auto_enabled !== undefined) {
    db.prepare("UPDATE routing_config SET value = ?, updated_at = ? WHERE key = 'auto_enabled'").run(req.body.auto_enabled ? '1' : '0', now);
  }
  res.json({ success: true, default_strategy: getDefaultStrategy(), auto_enabled: isAutoRoutingEnabled() });
});

router.get('/auto-preview', (req: Request, res: Response) => {
  const { tools, vision, json_mode, strategy } = req.query;
  const caps: DetectedCapabilities = {
    requiresTools: tools === '1' || tools === 'true',
    requiresVision: vision === '1' || vision === 'true',
    requiresJsonMode: json_mode === '1' || json_mode === 'true',
  };
  const effectiveStrategy = (strategy as RoutingStrategy) || getDefaultStrategy();
  const allModels = getScoredModels();
  const capable = filterByCapabilities(allModels, caps);
  const ranked = rankByStrategy(capable.length > 0 ? capable : allModels, effectiveStrategy);

  res.json({
    capabilities: caps,
    strategy: effectiveStrategy,
    total_active_models: allModels.length,
    matching_models: capable.length,
    candidates: ranked.slice(0, 10),
    selected: ranked[0] || null,
    fallbacks: ranked.slice(1, 5) || [],
  });
});

export default router;
