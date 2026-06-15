// ============================================================
// Shared types for OpenClaw Router
// ============================================================

// --- Database row types ---

export interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  balance_cents: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  rate_limit_rpm: number;
  is_active: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  is_active: number;
  priority: number;
  timeout_ms: number;
  max_retries: number;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelRow {
  id: string;
  model_id: string;
  display_name: string;
  provider_id: string;
  provider_model_id: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  max_tokens: number | null;
  supports_tools: number;
  supports_vision: number;
  supports_json_mode: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RouteRow {
  id: string;
  model_id: string;
  display_name: string;
  strategy: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RouteEntryRow {
  id: string;
  route_id: string;
  provider_id: string;
  provider_model_id: string;
  priority: number;
  weight: number;
  is_active: number;
}

export interface UsageLogRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  model_id: string;
  provider_id: string;
  provider_model_id: string;
  request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
  latency_ms: number | null;
  ttft_ms: number | null;
  finish_reason: string | null;
  status: string;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface BalanceTransactionRow {
  id: string;
  user_id: string;
  amount_cents: number;
  balance_after_cents: number;
  type: string;
  description: string;
  reference_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

// --- Provider types ---

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  extra: Record<string, any>;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'input_audio';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
  input_audio?: { data: string; format: string };
  cache_control?: { type: 'ephemeral' };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  tools?: ToolDef[];
  tool_choice?: any;
  response_format?: any;
  user?: string;
  thinking?: any;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // Provider-reported prompt-cache hits. Anthropic sets these in
  // message_start/message_delta; OpenAI-compatible providers like
  // MiniMax put them under usage.prompt_tokens_details.cached_tokens.
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ProviderResponse {
  id: string;
  model: string;
  choices: ProviderChoice[];
  usage: TokenUsage;
}

export interface ProviderChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface StreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Partial<ToolCall>[];
      thinking?: string;
      thinking_signature?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: TokenUsage;
}

export interface ProviderError {
  status: number;
  message: string;
  code?: string;
  retryable: boolean;
}

// --- Route resolution ---

export interface ResolvedRouteEntry {
  providerConfig: ProviderConfig;
  providerModelId: string;
  model: ModelRow;
  provider: ProviderRow;
  priority: number;
}

// --- Quality & Auto-Routing types ---

export type RoutingStrategy = 'priority' | 'cheapest' | 'quality' | 'balanced' | 'fastest';

export interface DetectedCapabilities {
  requiresTools: boolean;
  requiresVision: boolean;
  requiresJsonMode: boolean;
}

export interface ScoredModel {
  modelId: string;
  displayName: string;
  providerId: string;
  providerName: string;
  providerModelId: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  blendedCost: number;
  qualityScore: number;
  latencyP50: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
}

// --- Express request augmentation ---

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      apiKeyId?: string;
      rateLimitRpm?: number;
      adminId?: number;
      adminUsername?: string;
    }
  }
}

// --- OpenAI API request/response types ---

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | any;
    tool_calls?: any;
    tool_call_id?: string;
    name?: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: any[];
  response_format?: any;
  user?: string;
  n?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: any[];
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// --- Dashboard stats ---

export interface DashboardStats {
  totalUsers: number;
  activeKeys: number;
  requestsToday: number;
  costTodayCents: number;
  totalRequests: number;
  totalCostCents: number;
}
