import type { ChatCompletionRequest, DetectedCapabilities, RoutingStrategy, ScoredModel } from '../types';
import { getDb } from '../db/connection';
import { getQualityScore, getLatencyP50 } from './quality-scores';

export function detectCapabilities(request: ChatCompletionRequest): DetectedCapabilities {
  const requiresTools = !!(request.tools && request.tools.length > 0);
  const requiresVision = request.messages.some(msg => {
    if (typeof msg.content === 'string') return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some(part =>
        part.type === 'image_url' || part.type === 'image' || part.type === 'input_image'
      );
    }
    return false;
  });
  const requiresJsonMode = !!(
    request.response_format &&
    typeof request.response_format === 'object' &&
    (request.response_format.type === 'json_object' || request.response_format.type === 'json_schema')
  );
  return { requiresTools, requiresVision, requiresJsonMode };
}

export function getScoredModels(): ScoredModel[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT m.*, p.name as provider_name
    FROM models m JOIN providers p ON m.provider_id = p.id
    WHERE m.is_active = 1 AND p.is_active = 1
  `).all() as any[];
  return rows.map(row => ({
    modelId: row.model_id,
    displayName: row.display_name,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerModelId: row.provider_model_id,
    inputPricePer1k: row.input_price_per_1k,
    outputPricePer1k: row.output_price_per_1k,
    blendedCost: 0.3 * row.input_price_per_1k + 0.7 * row.output_price_per_1k,
    qualityScore: getQualityScore(row.model_id),
    latencyP50: getLatencyP50(row.model_id, row.provider_id),
    supportsTools: !!row.supports_tools,
    supportsVision: !!row.supports_vision,
    supportsJsonMode: !!row.supports_json_mode,
  }));
}

export function filterByCapabilities(models: ScoredModel[], caps: DetectedCapabilities): ScoredModel[] {
  return models.filter(m => {
    if (caps.requiresTools && !m.supportsTools) return false;
    if (caps.requiresVision && !m.supportsVision) return false;
    if (caps.requiresJsonMode && !m.supportsJsonMode) return false;
    return true;
  });
}

export function rankByStrategy(models: ScoredModel[], strategy: RoutingStrategy): ScoredModel[] {
  const arr = [...models];
  switch (strategy) {
    case 'cheapest':
      arr.sort((a, b) => a.blendedCost - b.blendedCost || a.modelId.localeCompare(b.modelId));
      break;
    case 'quality':
      arr.sort((a, b) => b.qualityScore - a.qualityScore || a.blendedCost - b.blendedCost || a.modelId.localeCompare(b.modelId));
      break;
    case 'balanced': {
      const maxCost = Math.max(...arr.map(m => m.blendedCost), 0.001);
      arr.sort((a, b) => {
        const aScore = 0.5 * (a.qualityScore / 100) + 0.5 * (1 - a.blendedCost / maxCost);
        const bScore = 0.5 * (b.qualityScore / 100) + 0.5 * (1 - b.blendedCost / maxCost);
        return bScore - aScore || a.blendedCost - b.blendedCost || a.modelId.localeCompare(b.modelId);
      });
      break;
    }
    case 'fastest':
      arr.sort((a, b) => {
        if (a.latencyP50 === null && b.latencyP50 === null) return a.modelId.localeCompare(b.modelId);
        if (a.latencyP50 === null) return 1;
        if (b.latencyP50 === null) return -1;
        return a.latencyP50 - b.latencyP50 || a.modelId.localeCompare(b.modelId);
      });
      break;
    case 'priority':
    default:
      break;
  }
  return arr;
}

export function autoRoute(
  request: ChatCompletionRequest,
  strategy: RoutingStrategy
): { selectedModelId: string; fallbackModelIds: string[]; candidates: ScoredModel[] } {
  const caps = detectCapabilities(request);
  const allModels = getScoredModels();
  const capable = filterByCapabilities(allModels, caps);
  const pool = capable.length > 0 ? capable : allModels;
  const ranked = rankByStrategy(pool, strategy);
  if (ranked.length === 0) return { selectedModelId: '', fallbackModelIds: [], candidates: [] };
  return {
    selectedModelId: ranked[0].modelId,
    fallbackModelIds: ranked.slice(1, 5).map(m => m.modelId),
    candidates: ranked,
  };
}

export function getDefaultStrategy(): RoutingStrategy {
  const db = getDb();
  const row = db.prepare("SELECT value FROM routing_config WHERE key = 'default_strategy'").get() as { value: string } | undefined;
  return (row?.value as RoutingStrategy) || 'priority';
}

export function isAutoRoutingEnabled(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT value FROM routing_config WHERE key = 'auto_enabled'").get() as { value: string } | undefined;
  return row?.value !== '0';
}
