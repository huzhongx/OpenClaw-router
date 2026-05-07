import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { errorHandler } from './middleware/error-handler';

// Routes
import v1ChatRouter from './routes/v1/chat';
import v1ModelsRouter from './routes/v1/models';
import v1MessagesRouter from './routes/v1/messages';
import adminAuthRouter from './routes/admin/auth';
import adminUsersRouter from './routes/admin/users';
import adminApiKeysRouter from './routes/admin/api-keys';
import adminProvidersRouter from './routes/admin/providers';
import adminModelsRouter from './routes/admin/models';
import adminRoutesRouter from './routes/admin/routes';
import adminDashboardRouter from './routes/admin/dashboard';
import adminUsageRouter from './routes/admin/usage';
import adminBillingRouter from './routes/admin/billing';
import dashboardRouter from './dashboard/dashboard';
import userBalanceRouter from './routes/user/balance';
import userUsageRouter from './routes/user/usage';
import userKeysRouter from './routes/user/keys';

/**
 * Raw body parser for streaming API routes.
 * Replaces express.json() with manual collection — higher limit (50MB),
 * 30s body-read timeout, and parses JSON into req.body.
 */
function rawBodyParser(maxBytes: number, timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();

    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      if (!res.headersSent) {
        res.status(408).json({ type: 'error', error: { type: 'timeout', message: 'Request body read timeout' } });
      }
      req.destroy();
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        clearTimeout(timer);
        if (!res.headersSent) {
          res.status(413).json({ type: 'error', error: { type: 'invalid_request_error', message: 'Request body too large' } });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      clearTimeout(timer);
      try {
        req.body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        if (!res.headersSent) {
          res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } });
          return;
        }
      }
      next();
    });

    req.on('error', () => {
      clearTimeout(timer);
      if (!settled && !res.headersSent) res.status(400).end();
    });
  };
}

export function createApp(): express.Application {
  const app = express();

  // CORS
  const corsOrigins = config.corsOrigins.split(',').map(s => s.trim());
  app.use(cors({
    origin: corsOrigins[0] === '*' ? true : corsOrigins,
    credentials: true,
  }));

  // Compression (gzip) — skip for SSE streams to avoid buffering
  app.use(compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    },
  }));

  // ---- Streaming API routes: send SSE headers before body parsing ----

  // Phase 1: Flush SSE headers immediately so client sees connection established
  // Only set headers — do NOT write any body content here.
  // If auth/body parsing fails later, the error handler can still send a proper response.
  app.use('/v1/messages', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }
    next();
  });

  // Phase 2: Raw body collector for /v1/messages (50MB limit, 30s timeout)
  app.use('/v1/messages', rawBodyParser(50 * 1024 * 1024, 30_000));

  // Phase 3: Raw body collector for /v1/chat/completions (50MB limit, 30s timeout)
  app.use('/v1/chat/completions', rawBodyParser(50 * 1024 * 1024, 30_000));

  // Body parsing for all other routes
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Request logging
  if (config.logRequests) {
    app.use((req, _res, next) => {
      const start = Date.now();
      _res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.path} ${_res.statusCode} ${ms}ms`);
      });
      next();
    });
  }

  // Dashboard
  app.use('/', dashboardRouter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Admin routes
  app.use('/admin', adminAuthRouter);
  app.use('/admin/users', adminUsersRouter);
  app.use('/admin/api-keys', adminApiKeysRouter);
  app.use('/admin/providers', adminProvidersRouter);
  app.use('/admin/models', adminModelsRouter);
  app.use('/admin/routes', adminRoutesRouter);
  app.use('/admin/dashboard', adminDashboardRouter);
  app.use('/admin/usage', adminUsageRouter);
  app.use('/admin/billing', adminBillingRouter);

  // User routes (require API key)
  app.use('/user', userBalanceRouter, userUsageRouter, userKeysRouter);

  // OpenAI-compatible API routes (require API key)
  app.use('/v1', v1ChatRouter, v1ModelsRouter, v1MessagesRouter);

  // Global error handler
  app.use(errorHandler);

  return app;
}
