import type { ProviderRow, ModelRow, RouteRow, RouteEntryRow, ProviderConfig, ResolvedRouteEntry } from '../types';
import { getDb } from '../db/connection';
import { config } from '../config';
import { createProvider } from './registry';
import { BaseProvider } from './base';
import { getDefaultStrategy, isAutoRoutingEnabled } from '../services/auto-routing';
import { decrypt } from '../services/encryption';

function rowToProviderConfig(row: ProviderRow): ProviderConfig {
  let apiKey = row.api_key ? decrypt(row.api_key) : '';

  // Environment variable overrides
  const envKey = config.providerKeys[row.type as keyof typeof config.providerKeys];
  if (envKey) apiKey = envKey;

  // Also check PROVIDER_<NAME>_API_KEY
  const envOverride = process.env[`PROVIDER_${row.name.toUpperCase()}_API_KEY`];
  if (envOverride) apiKey = envOverride;

  // Check PROVIDER_<NAME>_BASE_URL
  const envBaseUrl = process.env[`PROVIDER_${row.name.toUpperCase()}_BASE_URL`];
  const baseUrl = envBaseUrl || row.base_url;

  let extra: Record<string, any> = {};
  if (row.config_json) {
    try { extra = JSON.parse(row.config_json); } catch { /* ignore */ }
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl,
    apiKey,
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    extra,
  };
}

export class AutoRouteRequiredError extends Error {
  public readonly strategy: string;
  constructor(strategy: string) {
    super('Auto-routing requires request body');
    this.name = 'AutoRouteRequiredError';
    this.strategy = strategy;
  }
}

export function resolveRoute(modelId: string): ResolvedRouteEntry[] {
  if (modelId === 'auto') {
    if (!isAutoRoutingEnabled()) throw new Error('Auto-routing is not enabled');
    throw new AutoRouteRequiredError(getDefaultStrategy());
  }
  return resolveRouteInternal(modelId);
}

export function resolveRouteWithFallbacks(modelIds: string[]): ResolvedRouteEntry[] {
  const allEntries: ResolvedRouteEntry[] = [];
  const seen = new Set<string>();
  for (const mid of modelIds) {
    try {
      for (const entry of resolveRouteInternal(mid)) {
        const key = `${entry.providerConfig.id}:${entry.providerModelId}`;
        if (!seen.has(key)) {
          seen.add(key);
          allEntries.push(entry);
        }
      }
    } catch { /* skip unresolvable models */ }
  }
  if (allEntries.length === 0) throw new Error('No models available for auto-routing');
  return allEntries;
}

function resolveRouteInternal(modelId: string): ResolvedRouteEntry[] {
  const db = getDb();

  // First check routes table for this model
  const route = db.prepare(
    'SELECT * FROM routes WHERE model_id = ? AND is_active = 1'
  ).get(modelId) as RouteRow | undefined;

  if (route) {
    const entries = db.prepare(
      'SELECT re.*, p.name as provider_name, p.type, p.base_url, p.api_key, p.timeout_ms, p.max_retries, p.config_json FROM route_entries re JOIN providers p ON re.provider_id = p.id WHERE re.route_id = ? AND re.is_active = 1 AND p.is_active = 1 ORDER BY re.priority ASC'
    ).all(route.id) as (RouteEntryRow & ProviderRow & { provider_name: string })[];

    if (entries.length > 0) {
      return entries.map(e => ({
        providerConfig: rowToProviderConfig(e),
        providerModelId: e.provider_model_id,
        model: {
          id: '',
          model_id: modelId,
          display_name: route.display_name,
          provider_id: e.provider_id,
          provider_model_id: e.provider_model_id,
          input_price_per_1k: 0,
          output_price_per_1k: 0,
          max_tokens: null,
          supports_tools: 0,
          supports_vision: 0,
          supports_json_mode: 0,
          is_active: 1,
          created_at: '',
          updated_at: '',
        },
        provider: e,
        priority: e.priority,
      }));
    }
  }

  // Fallback: look up models table directly
  const model = db.prepare(
    'SELECT m.*, p.name as provider_name, p.name as name, p.type, p.base_url, p.api_key, p.timeout_ms, p.max_retries, p.config_json, p.priority as provider_priority FROM models m JOIN providers p ON m.provider_id = p.id WHERE m.model_id = ? AND m.is_active = 1 AND p.is_active = 1'
  ).get(modelId) as (ModelRow & ProviderRow & { provider_name: string; provider_priority: number }) | undefined;

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  return [{
    providerConfig: rowToProviderConfig(model),
    providerModelId: model.provider_model_id,
    model,
    provider: model,
    priority: model.provider_priority,
  }];
}

export function resolveModel(modelId: string): ModelRow | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM models WHERE model_id = ? AND is_active = 1'
  ).get(modelId) as ModelRow | undefined;
}

export function listActiveModels(): ModelRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT m.*, p.name as provider_name FROM models m JOIN providers p ON m.provider_id = p.id WHERE m.is_active = 1 AND p.is_active = 1 ORDER BY m.model_id'
  ).all() as (ModelRow & { provider_name: string })[];
}
