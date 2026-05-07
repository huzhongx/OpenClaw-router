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

export function createApp(): express.Application {
  const app = express();

  // CORS
  const corsOrigins = config.corsOrigins.split(',').map(s => s.trim());
  app.use(cors({
    origin: corsOrigins[0] === '*' ? true : corsOrigins,
    credentials: true,
  }));

  // Body parsing (50MB for large Claude Code requests with tools/context)
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  // Compression (gzip) — skip for SSE streams to avoid buffering
  app.use(compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    },
  }));

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
