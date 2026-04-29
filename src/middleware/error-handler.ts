import { Request, Response, NextFunction } from 'express';
import type { ProviderError } from '../types';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  // Provider errors
  if (err && err.retryable !== undefined) {
    const pe = err as ProviderError;
    logger.warn({ status: pe.status, code: pe.code, model: req.body?.model, path: req.path }, pe.message);
    res.status(pe.status).json({
      error: {
        message: pe.message,
        type: 'upstream_error',
        param: null,
        code: pe.code || null,
      },
    });
    return;
  }

  // Zod validation errors
  if (err && err.issues) {
    res.status(400).json({
      error: {
        message: err.issues.map((i: any) => i.message).join(', '),
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request',
      },
    });
    return;
  }

  // JWT errors
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    res.status(401).json({
      error: {
        message: err.message,
        type: 'auth_error',
        param: null,
        code: 'invalid_token',
      },
    });
    return;
  }

  // Unknown errors
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'internal_error',
      param: null,
      code: null,
    },
  });
}
