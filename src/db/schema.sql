-- OpenClaw Router - Initial Schema
-- SQLite

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT '',
  email           TEXT UNIQUE,
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE TABLE IF NOT EXISTS api_keys (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL DEFAULT 'default',
  key_hash        TEXT NOT NULL UNIQUE,
  key_prefix      TEXT NOT NULL,
  rate_limit_rpm  INTEGER NOT NULL DEFAULT 60,
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_used_at    TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active, key_prefix);

CREATE TABLE IF NOT EXISTS providers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'openai-compatible',
  base_url        TEXT NOT NULL,
  api_key         TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 0,
  timeout_ms      INTEGER NOT NULL DEFAULT 30000,
  max_retries     INTEGER NOT NULL DEFAULT 1,
  config_json     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  id                  TEXT PRIMARY KEY,
  model_id            TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  provider_id         TEXT NOT NULL REFERENCES providers(id),
  provider_model_id   TEXT NOT NULL,
  input_price_per_1k  REAL NOT NULL DEFAULT 0,
  output_price_per_1k REAL NOT NULL DEFAULT 0,
  max_tokens          INTEGER,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_models_model_id ON models(model_id);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
CREATE INDEX IF NOT EXISTS idx_models_active ON models(is_active);

CREATE TABLE IF NOT EXISTS routes (
  id              TEXT PRIMARY KEY,
  model_id        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  strategy        TEXT NOT NULL DEFAULT 'priority',
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS route_entries (
  id                  TEXT PRIMARY KEY,
  route_id            TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  provider_id         TEXT NOT NULL REFERENCES providers(id),
  provider_model_id   TEXT NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,
  weight              INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_route_entries_route_id ON route_entries(route_id, priority);

CREATE TABLE IF NOT EXISTS usage_logs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  api_key_id          TEXT REFERENCES api_keys(id),
  model_id            TEXT NOT NULL,
  provider_id         TEXT NOT NULL,
  provider_name       TEXT NOT NULL DEFAULT '',
  provider_model_id   TEXT NOT NULL,
  request_id          TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  cost_cents          INTEGER NOT NULL DEFAULT 0,
  latency_ms          INTEGER,
  status              TEXT NOT NULL DEFAULT 'success',
  error_message       TEXT,
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model_id ON usage_logs(model_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_id ON usage_logs(provider_id, created_at);

CREATE TABLE IF NOT EXISTS balance_transactions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  amount_cents        INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  type                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  reference_id        TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_balance_txns_user_id ON balance_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_balance_txns_type ON balance_transactions(type);

CREATE TABLE IF NOT EXISTS system_config (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
