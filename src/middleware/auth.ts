import { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/key-manager';
import { config } from '../config';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Invalid API key format. Expected: Bearer ocr-xxx',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
    return;
  }

  const rawKey = authHeader.slice(7); // after "Bearer "
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
