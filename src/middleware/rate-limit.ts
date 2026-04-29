import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  tokens: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// Clean up expired entries every 60 seconds
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60000);
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  ensureCleanup();

  const keyId = req.apiKeyId || req.ip || 'unknown';
  const rpm = req.rateLimitRpm || 60;
  const now = Date.now();

  let entry = store.get(keyId);
  if (!entry || entry.resetAt <= now) {
    entry = { tokens: 0, resetAt: now + 60000 };
    store.set(keyId, entry);
  }

  entry.tokens++;

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', rpm);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, rpm - entry.tokens));
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.tokens > rpm) {
    res.status(429).json({
      error: {
        message: 'Rate limit exceeded. Please slow down.',
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
    });
    return;
  }

  next();
}
