import type { Request, RequestHandler, Response } from 'express';

interface RateLimitEntry {
  count: number;
  windowStartedAtMs: number;
}

function resolveClientKey(request: Request): string {
  return (request.ip || request.socket.remoteAddress || 'unknown').trim().toLowerCase();
}

export function createRateLimitMiddleware({
  code = 'RATE_LIMITED',
  keyFn = resolveClientKey,
  maxRequests,
  message = 'Too many requests. Please retry shortly.',
  nowFn = Date.now,
  windowMs
}: {
  code?: string;
  keyFn?: (request: Request) => string;
  maxRequests: number;
  message?: string;
  nowFn?: () => number;
  windowMs: number;
}): RequestHandler {
  if (maxRequests <= 0 || windowMs <= 0) {
    return (_request: Request, _response: Response, next) => next();
  }

  const store = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next): void => {
    const now = nowFn();
    const key = keyFn(request);
    const existing = store.get(key);

    if (!existing || now - existing.windowStartedAtMs >= windowMs) {
      store.set(key, { count: 1, windowStartedAtMs: now });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > maxRequests) {
      response.status(429).json({ code, error: message });
      return;
    }

    next();
  };
}
