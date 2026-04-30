import { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/key-manager';
import { config } from '../config';

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
    res.status(401).json({
      error: {
        message: 'Invalid API key format. Expected: Bearer xxx or x-api-key header',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
    return;
  }

  const result = validateApiKey(rawKey);

  if (!result) {
    res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
    return;
  }

  req.userId = result.userId;
  req.apiKeyId = result.apiKeyId;
  req.rateLimitRpm = result.rateLimitRpm;
  next();
}
