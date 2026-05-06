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
