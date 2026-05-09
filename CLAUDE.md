# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw Router is an AI model routing gateway that provides unified OpenAI/Anthropic-compatible APIs, aggregating multiple providers (OpenAI, Anthropic, Gemini, Mistral, Minimax, etc.) with fallback chains, billing, and a management dashboard.

## Commands

```bash
npm run dev          # Development with hot reload (tsx watch)
npm run build        # TypeScript compile + copy assets (dashboard HTML, SQL schema)
npm start            # Run compiled dist/index.js
npm run seed         # Initialize DB with admin user and default data
npm run create-admin # Create admin user interactively
npm run migrate      # Run database migrations
npx tsc --noEmit     # Type check only (no output)
```

No test framework is configured. Verify changes with `npx tsc --noEmit` and manual testing.

## Architecture

### Request Flow

1. Express middleware chain: body parsing → auth → rate limiting → route handler
2. Route handler validates request with Zod schema
3. `resolveRoute(modelId)` looks up routing config, falls back to models table
4. `createProvider(config)` instantiates the provider (registry pattern)
5. Provider executes request (streaming or non-streaming)
6. Usage is logged and balance deducted after response completes

### Provider Plugin System

- **Base class**: `src/providers/base.ts` — abstract `chat()`, `chatStream()`, `testConnection()`
- **Registry**: `src/providers/registry.ts` — maps `provider.type` string to class
- **Implementations**: `openai.ts`, `anthropic.ts`, `gemini.ts`, `mistral.ts`, `openai-compatible.ts`
- Adding a provider: create class extending `BaseProvider`, register in `registry.ts`

### Streaming

- SSE via `text/event-stream` with 5-second keepalive pings
- **Critical**: Use `res.on('close')` for client disconnect detection, NOT `req.on('close')` (Node.js v22 fires `req close` as false positive)
- Connection timeout uses manual `AbortController` + `clearTimeout` — do NOT use `AbortSignal.timeout()` as it kills the stream after the timeout even after fetch returns
- OpenAI-compatible providers send `stream_options: { include_usage: true }` for token counting

### Database

- SQLite with WAL mode via `better-sqlite3` (synchronous API)
- Schema: `src/db/schema.sql`
- Provider API keys are AES-256 encrypted in DB (`src/services/encryption.ts`)
- Environment overrides: `PROVIDER_{NAME}_API_KEY` and `PROVIDER_{NAME}_BASE_URL` override DB config

### Billing

- All costs stored as integer cents (USD * 100)
- Per-token pricing: `(tokens * price_per_1k) / 1000`
- Token counting: provider-reported usage first, character-based estimation as fallback

### Dashboard

- Single HTML file: `src/dashboard/index.html` — pure vanilla JS, no build step
- SPA with hash-based routing (`#/dashboard`, `#/providers`, etc.)
- JWT auth separate from API key auth
- Filter pattern: global state variables (`dashboardProvider`, `dashboardUser`) passed as query params to `/admin/dashboard/*` endpoints

## Key Files

| File | Purpose |
|------|---------|
| `src/config.ts` | Environment config, defaults, provider key env vars |
| `src/types.ts` | All TypeScript interfaces (ProviderConfig, ProviderRequest, StreamChunk, etc.) |
| `src/providers/router.ts` | Route resolution with multi-provider fallback and auto-routing strategies |
| `src/routes/v1/chat.ts` | OpenAI `/v1/chat/completions` endpoint |
| `src/routes/v1/messages.ts` | Anthropic `/v1/messages` endpoint with SSE conversion |
| `src/routes/admin/dashboard.ts` | Dashboard API endpoints with provider/user filters |
| `src/middleware/auth.ts` | API key validation (SHA-256 hash, supports Bearer and x-api-key) |
| `src/services/key-manager.ts` | Key hashing, validation, and CRUD |

## Conventions

- Provider errors carry `retryable: boolean` and `status: number` for fallback logic
- Zod schemas validate all API inputs before processing
- SQL filter helpers use parameterized queries (`?` placeholders) to prevent injection
- pino for structured JSON logging
