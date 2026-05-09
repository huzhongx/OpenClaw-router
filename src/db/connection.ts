import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.resolve(config.dbPath);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    // Run initial schema
    const schema = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schema);

    // Migration: add ttft_ms column if missing
    try { db.exec('ALTER TABLE usage_logs ADD COLUMN ttft_ms INTEGER'); } catch { /* column already exists */ }

    // Migration: add capability flags to models table
    try { db.exec('ALTER TABLE models ADD COLUMN supports_tools INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
    try { db.exec('ALTER TABLE models ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
    try { db.exec('ALTER TABLE models ADD COLUMN supports_json_mode INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }

    // Seed routing config defaults
    const hasStrategy = db.prepare("SELECT 1 FROM routing_config WHERE key = 'default_strategy'").get();
    if (!hasStrategy) db.prepare("INSERT INTO routing_config (key, value) VALUES ('default_strategy', 'priority')").run();
    const hasAutoEnabled = db.prepare("SELECT 1 FROM routing_config WHERE key = 'auto_enabled'").get();
    if (!hasAutoEnabled) db.prepare("INSERT INTO routing_config (key, value) VALUES ('auto_enabled', '1')").run();

    // Migration: add performance indexes
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_name_status ON usage_logs(provider_name, status, created_at)'); } catch { /* already exists */ }
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_usage_logs_status_created ON usage_logs(status, created_at)'); } catch { /* already exists */ }
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_routes_model_id_active ON routes(model_id, is_active)'); } catch { /* already exists */ }
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(is_active)'); } catch { /* already exists */ }

    logger.info({ dbPath }, 'Database initialized');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
