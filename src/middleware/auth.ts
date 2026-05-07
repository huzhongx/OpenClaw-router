import { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/key-manager';
import { config } from '../config';

function sendError(req: Request, res: Response, status: number, message: string, code: string): void {
  // If SSE headers already flushed, send error as SSE event
  if (res.headersSent) {
    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`);
    res.end();
    return;
  }
  res.status(status).json({
    error: {
      message,
      type: 'invalid_request_error',
      param: null,
      code,
    },
  });
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Support both Authorization: Bearer xxx and x-api-key: xxx
  let rawKey: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7);
  } else if (req.headers['x-api-key']) {
    rawKey = req.headers['x-api-key'] as string;
  }

  if (!rawKey) {
    sendError(req, res, 401, 'Invalid API key format. Expected: Bearer xxx or x-api-key header', 'invalid_api_key');
    return;
  }

  const result = validateApiKey(rawKey);

  if (!result) {
    sendError(req, res, 401, 'Invalid API key', 'invalid_api_key');
    return;
  }

  req.userId = result.userId;
  req.apiKeyId = result.apiKeyId;
  req.rateLimitRpm = result.rateLimitRpm;
  next();
}
