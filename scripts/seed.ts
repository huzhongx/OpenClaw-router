import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../src/db/connection';
import { config } from '../src/config';

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function seed() {
  const db = getDb();

  // Create admin user
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(config.adminUsername);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(config.adminPassword, 10);
    db.prepare('INSERT INTO admins (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(config.adminUsername, hash, 'Admin', now(), now());
    console.log(`Admin user "${config.adminUsername}" created`);
  } else {
    console.log(`Admin user "${config.adminUsername}" already exists`);
  }

  // Seed providers
  const providers = [
    { name: 'openai', type: 'openai', base_url: 'https://api.openai.com/v1', priority: 0 },
    { name: 'anthropic', type: 'anthropic', base_url: 'https://api.anthropic.com/v1', priority: 1 },
    { name: 'gemini', type: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', priority: 2 },
    { name: 'mistral', type: 'mistral', base_url: 'https://api.mistral.ai/v1', priority: 3 },
    { name: 'ollama', type: 'openai-compatible', base_url: 'http://localhost:11434/v1', priority: 10 },
  ];

  const insertProvider = db.prepare(
    'INSERT OR IGNORE INTO providers (id, name, type, base_url, api_key, is_active, priority, timeout_ms, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 30000, 1, ?, ?)'
  );

  const providerIds: Record<string, string> = {};
  for (const p of providers) {
    const id = uuidv4();
    providerIds[p.name] = id;
    insertProvider.run(id, p.name, p.type, p.base_url, null, p.priority, now(), now());
    console.log(`Provider "${p.name}" seeded`);
  }

  // Seed models with pricing (per 1K tokens in USD)
  const models = [
    { model_id: 'gpt-4o', display_name: 'GPT-4o', provider: 'openai', provider_model_id: 'gpt-4o', input_price: 0.0025, output_price: 0.01, max_tokens: 128000 },
    { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini', provider: 'openai', provider_model_id: 'gpt-4o-mini', input_price: 0.00015, output_price: 0.0006, max_tokens: 128000 },
    { model_id: 'gpt-4.1', display_name: 'GPT-4.1', provider: 'openai', provider_model_id: 'gpt-4.1', input_price: 0.002, output_price: 0.008, max_tokens: 1047576 },
    { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini', provider: 'openai', provider_model_id: 'gpt-4.1-mini', input_price: 0.0004, output_price: 0.0016, max_tokens: 1047576 },
    { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', provider: 'anthropic', provider_model_id: 'claude-sonnet-4-20250514', input_price: 0.003, output_price: 0.015, max_tokens: 200000 },
    { model_id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', provider: 'anthropic', provider_model_id: 'claude-haiku-4-5-20251001', input_price: 0.0008, output_price: 0.004, max_tokens: 200000 },
    { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', provider: 'gemini', provider_model_id: 'gemini-2.5-pro-preview-06-05', input_price: 0.00125, output_price: 0.01, max_tokens: 1048576 },
    { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', provider: 'gemini', provider_model_id: 'gemini-2.5-flash-preview-05-20', input_price: 0.00015, output_price: 0.0006, max_tokens: 1048576 },
    { model_id: 'mistral-large', display_name: 'Mistral Large', provider: 'mistral', provider_model_id: 'mistral-large-latest', input_price: 0.002, output_price: 0.006, max_tokens: 128000 },
    { model_id: 'mistral-small', display_name: 'Mistral Small', provider: 'mistral', provider_model_id: 'mistral-small-latest', input_price: 0.0002, output_price: 0.0006, max_tokens: 32000 },
  ];

  const insertModel = db.prepare(
    'INSERT OR IGNORE INTO models (id, model_id, display_name, provider_id, provider_model_id, input_price_per_1k, output_price_per_1k, max_tokens, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
  );

  for (const m of models) {
    const providerId = providerIds[m.provider];
    if (!providerId) continue;
    insertModel.run(uuidv4(), m.model_id, m.display_name, providerId, m.provider_model_id, m.input_price, m.output_price, m.max_tokens, now(), now());
    console.log(`Model "${m.model_id}" seeded`);
  }

  console.log('\nSeed complete! Run `npm run dev` to start the server.');
  console.log('Default admin: username=' + config.adminUsername + ' password=' + config.adminPassword);
}

seed();
