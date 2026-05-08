import { getDb } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';

const LITELLM_DATA_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/master/model_prices_and_context_window.json';

// Provider name mapping: litellm_provider → openclaw provider name
const PROVIDER_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  anthropic_bedrock: 'anthropic',
  anthropic_vertex: 'anthropic',
  gemini: 'gemini',
  vertex_ai: 'gemini',
  google_vertex_ai: 'gemini',
  mistral: 'mistral',
  mistral_azure: 'mistral',
  bedrock: 'aws-bedrock',
  azure: 'azure',
  cohere: 'cohere',
  groq: 'groq',
  together_ai: 'together',
  deepinfra: 'deepinfra',
  fireworks_ai: 'fireworks',
  openrouter: 'openrouter',
  perplexity: 'perplexity',
  xai: 'xai',
  databricks: 'databricks',
  cerebras: 'cerebras',
  sambanova: 'sambanova',
  voyage: 'voyage',
  ai21: 'ai21',
};

// Known base URLs for common OpenAI-compatible providers
const PROVIDER_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  'fireworks_ai-embedding-models': 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  perplexity: 'https://api.perplexity.ai',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  'cohere_chat': 'https://api.cohere.ai/v1',
  cohere: 'https://api.cohere.ai/v1',
  replicate: 'https://api.replicate.com/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zai: 'https://api.zai.chat/v1',
  novita: 'https://api.novita.ai/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1',
  friendliai: 'https://api.friendli.ai/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  databricks: 'https://{workspace_id}.databricks.com/serving-endpoints',
  lepton: 'https://api.lepton.ai/v1',
  ai21: 'https://api.ai21.com/studio/v1',
  'bedrock_converse': 'https://bedrock-runtime.{region}.amazonaws.com',
  'aws-bedrock': 'https://bedrock-runtime.{region}.amazonaws.com',
  'amazon_nova': 'https://bedrock-runtime.{region}.amazonaws.com',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  watsonx: 'https://{region}.ml.cloud.ibm.com',
  snowflake: 'https://{account_id}.snowflakecomputing.com/api/v2/cortex/inference',
  nscale: 'https://api.nscale.com/v1',
  oci: 'https://inference.{region}.oci.oraclecloud.com',
  github_copilot: 'https://api.githubcopilot.com',
  baseten: 'https://app.baseten.co',
  crusoe: 'https://api.crusoe.ai/v1',
  'lambda_ai': 'https://api.lambda.ai/v1',
  ovhcloud: 'https://eco-strapi.ai.ovh.net/v1',
  gigachat: 'https://gigachat.devices.sberbank.ru/api/v1',
  wandb: 'https://api.wandb.ai/v1',
  vercel_ai_gateway: 'https://gateway.ai.vercel.app/v1',
  llamagate: 'https://api.llamagate.ai/v1',
  sarvam: 'https://api.sarvam.ai/v1',
  gradient_ai: 'https://api.gradient.ai/api/v1',
  morph: 'https://api.morph.ai/v1',
  featherless_ai: 'https://api.featherless.ai/v1',
  lemonade: 'https://api.lemonade.ai/v1',
  'meta_llama': 'https://api.llama.meta.com/v1',
  'nlp_cloud': 'https://api.nlpcloud.io/v1',
  gmi: 'https://api.gmi.ai/v1',
  palm: 'https://generativelanguage.googleapis.com/v1beta',
  codestral: 'https://codestral.mistral.ai/v1',
  heroku: 'https://api.heroku.com/v1',
  sagemaker: '',
  azure: '',
  azure_ai: '',
  'bedrock_mantle': '',
  // Vertex AI variants need project/region config
  'vertex_ai-language-models': '',
  'vertex_ai-anthropic_models': '',
  'vertex_ai-mistral_models': '',
  'vertex_ai-deepseek_models': '',
  'vertex_ai-ai21_models': '',
  'vertex_ai-llama_models': '',
  'vertex_ai-minimax_models': '',
  'vertex_ai-moonshot_models': '',
  'vertex_ai-zai_models': '',
  'vertex_ai-openai_models': '',
  'vertex_ai-qwen_models': '',
  v0: '',
  anyscale: '',
  publicai: '',
};

interface LiteLLMModelEntry {
  mode?: string;
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  supports_function_calling?: boolean;
  supports_vision?: boolean;
  supports_response_schema?: boolean;
  supports_tool_choice?: boolean;
  deprecation_date?: string;
  max_input_tokens?: number;
  source?: string;
}

interface NormalizedModel {
  modelId: string;
  displayName: string;
  providerName: string;
  providerModelId: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  maxTokens: number | null;
  supportsTools: number;
  supportsVision: number;
  supportsJsonMode: number;
  maxInputTokens: number | null;
  source: string | null;
}

export interface ImportResult {
  success: boolean;
  total: number;
  imported: number;
  skipped: number;
  updated: number;
  newProviders: string[];
  error?: string;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function prettifyModelName(modelId: string): string {
  // e.g. "gpt-4o" → "GPT-4o", "claude-sonnet-4-20250514" → "Claude Sonnet 4"
  return modelId
    .split(/[-_/]/)
    .filter(part => !/^\d{4}-\d{2}-\d{2}$/.test(part)) // remove date suffixes
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeEntry(modelId: string, data: LiteLLMModelEntry): NormalizedModel | null {
  const inputPrice = (data.input_cost_per_token ?? 0) * 1000;
  const outputPrice = (data.output_cost_per_token ?? 0) * 1000;

  // Skip if no pricing data at all
  if (inputPrice === 0 && outputPrice === 0 && !data.max_tokens) return null;

  const litellmProvider = data.litellm_provider || 'unknown';
  const providerName = PROVIDER_MAP[litellmProvider] || litellmProvider;

  return {
    modelId,
    displayName: prettifyModelName(modelId),
    providerName,
    providerModelId: modelId,
    inputPricePer1k: Math.round(inputPrice * 1e8) / 1e8, // avoid floating point noise
    outputPricePer1k: Math.round(outputPrice * 1e8) / 1e8,
    maxTokens: data.max_output_tokens || data.max_tokens || null,
    supportsTools: (data.supports_function_calling || data.supports_tool_choice) ? 1 : 0,
    supportsVision: data.supports_vision ? 1 : 0,
    supportsJsonMode: data.supports_response_schema ? 1 : 0,
    maxInputTokens: data.max_input_tokens || null,
    source: data.source || null,
  };
}

function fetchAndNormalize(): Promise<NormalizedModel[]> {
  const https = require('https');

  return new Promise<NormalizedModel[]>((resolve, reject) => {
    const req = https.get(LITELLM_DATA_URL, { timeout: 30_000 }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        https.get(res.headers.location, { timeout: 30_000 }, (res2: any) => {
          let body = '';
          res2.on('data', (chunk: any) => { body += chunk; });
          res2.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(processData(data));
            } catch (e) {
              reject(new Error('Failed to parse LiteLLM data after redirect'));
            }
          });
        }).on('error', reject);
        return;
      }

      let body = '';
      res.on('data', (chunk: any) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(processData(data));
        } catch (e) {
          reject(new Error('Failed to parse LiteLLM data'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request to LiteLLM timed out')); });
  });
}

function processData(data: Record<string, LiteLLMModelEntry>): NormalizedModel[] {
  const results: NormalizedModel[] = [];

  for (const [modelId, entry] of Object.entries(data)) {
    // Skip non-chat models
    if (entry.mode && entry.mode !== 'chat') continue;

    // Skip deprecated models
    if (entry.deprecation_date) continue;

    // Skip entries without basic required fields
    if (!entry.litellm_provider && !entry.input_cost_per_token && !entry.output_cost_per_token) continue;

    const normalized = normalizeEntry(modelId, entry);
    if (normalized) {
      results.push(normalized);
    }
  }

  return results;
}

export async function previewLiteLLMImport(providerFilter?: string[]): Promise<{ total: number; models: NormalizedModel[] }> {
  let models = await fetchAndNormalize();

  if (providerFilter && providerFilter.length > 0) {
    const set = new Set(providerFilter.map(p => p.toLowerCase()));
    models = models.filter(m => set.has(m.providerName.toLowerCase()));
  }

  return { total: models.length, models: models.slice(0, 50) };
}

export async function importLiteLLMModels(options?: {
  providers?: string[];
  overwrite?: boolean;
}): Promise<ImportResult> {
  const db = getDb();
  const result: ImportResult = {
    success: false,
    total: 0,
    imported: 0,
    skipped: 0,
    updated: 0,
    newProviders: [],
  };

  try {
    let models = await fetchAndNormalize();

    // Apply provider filter
    if (options?.providers && options.providers.length > 0) {
      const set = new Set(options.providers.map(p => p.toLowerCase()));
      models = models.filter(m => set.has(m.providerName.toLowerCase()));
    }

    result.total = models.length;

    // Get existing providers
    const existingProviders = db.prepare('SELECT id, name FROM providers WHERE is_active = 1').all() as { id: string; name: string }[];
    const providerMap = new Map(existingProviders.map(p => [p.name.toLowerCase(), p.id]));

    // Collect provider names that need to be created
    const neededProviders = new Set<string>();
    for (const m of models) {
      if (!providerMap.has(m.providerName.toLowerCase())) {
        neededProviders.add(m.providerName);
      }
    }

    // Auto-create missing providers as openai-compatible
    const insertProvider = db.prepare(
      'INSERT OR IGNORE INTO providers (id, name, type, base_url, api_key, is_active, priority, timeout_ms, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 100, 30000, 1, ?, ?)'
    );

    for (const name of neededProviders) {
      const id = uuidv4();
      const baseUrl = PROVIDER_BASE_URLS[name.toLowerCase()] || '';
      insertProvider.run(id, name, 'openai-compatible', baseUrl, null, now(), now());
      providerMap.set(name.toLowerCase(), id);
      result.newProviders.push(name);
    }

    // Also update existing providers that have empty base_url
    const updateProviderUrl = db.prepare('UPDATE providers SET base_url = ?, updated_at = ? WHERE LOWER(name) = ? AND (base_url IS NULL OR base_url = ?)');
    for (const [name, url] of Object.entries(PROVIDER_BASE_URLS)) {
      if (url) updateProviderUrl.run(url, now(), name, '');
    }

    // Import models
    const insertModel = db.prepare(
      'INSERT OR IGNORE INTO models (id, model_id, display_name, provider_id, provider_model_id, input_price_per_1k, output_price_per_1k, max_tokens, supports_tools, supports_vision, supports_json_mode, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    );

    const updateModel = db.prepare(
      'UPDATE models SET input_price_per_1k = ?, output_price_per_1k = ?, max_tokens = ?, supports_tools = ?, supports_vision = ?, supports_json_mode = ?, updated_at = ? WHERE model_id = ?'
    );

    for (const m of models) {
      const providerId = providerMap.get(m.providerName.toLowerCase());
      if (!providerId) {
        result.skipped++;
        continue;
      }

      if (options?.overwrite) {
        const updated = updateModel.run(
          m.inputPricePer1k, m.outputPricePer1k, m.maxTokens,
          m.supportsTools, m.supportsVision, m.supportsJsonMode,
          now(), m.modelId
        );
        if (updated.changes > 0) {
          result.updated++;
        } else {
          // Model doesn't exist yet, insert it
          insertModel.run(
            uuidv4(), m.modelId, m.displayName, providerId, m.providerModelId,
            m.inputPricePer1k, m.outputPricePer1k, m.maxTokens,
            m.supportsTools, m.supportsVision, m.supportsJsonMode,
            now(), now()
          );
          result.imported++;
        }
      } else {
        const existing = db.prepare('SELECT id FROM models WHERE model_id = ?').get(m.modelId);
        if (existing) {
          result.skipped++;
        } else {
          insertModel.run(
            uuidv4(), m.modelId, m.displayName, providerId, m.providerModelId,
            m.inputPricePer1k, m.outputPricePer1k, m.maxTokens,
            m.supportsTools, m.supportsVision, m.supportsJsonMode,
            now(), now()
          );
          result.imported++;
        }
      }
    }

    result.success = true;
  } catch (err: any) {
    result.error = err.message || String(err);
  }

  return result;
}
