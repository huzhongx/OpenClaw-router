import dotenv from 'dotenv';
import path from 'path';

const envResult = dotenv.config({ path: path.resolve(process.cwd(), '.env') });
// Track which env vars came from .env so we can detect stale overrides
if (envResult.parsed) {
  for (const key of Object.keys(envResult.parsed)) {
    // dotenv won't override existing env vars, so if .env value is empty
    // but process.env has a stale value, clear it
    if (!envResult.parsed[key] && process.env[key]) {
      delete process.env[key];
    }
  }
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000')),
  host: optional('HOST', '0.0.0.0'),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',

  // Admin
  adminJwtSecret: required('ADMIN_JWT_SECRET'),
  adminUsername: optional('ADMIN_USERNAME', 'admin'),
  adminPassword: optional('ADMIN_PASSWORD', ''),

  // Database
  dbPath: optional('DB_PATH', './data/openclaw.db'),

  // API Keys
  apiKeyPrefix: optional('API_KEY_PREFIX', 'ocr'),
  corsOrigins: optional('CORS_ORIGINS', '*'),
  defaultRateLimitRpm: parseInt(optional('RATE_LIMIT_DEFAULT_RPM', '60')),

  // Provider keys from env (override DB)
  providerKeys: {
    openai: process.env.OPENAI_API_KEY || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    mistral: process.env.MISTRAL_API_KEY || '',
  },

  // Billing
  minimumBalanceCents: parseInt(optional('MINIMUM_BALANCE_CENTS', '0')),

  // Logging
  logLevel: optional('LOG_LEVEL', 'info'),
  logRequests: optional('LOG_REQUESTS', 'true') === 'true',
} as const;
