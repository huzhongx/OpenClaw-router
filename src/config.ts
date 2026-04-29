import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
