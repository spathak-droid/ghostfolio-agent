import express from 'express';
import { existsSync } from 'fs';
import type { RequestHandler } from 'express';

import { resolveWidgetCorsOrigin, resolveWidgetDistPath } from '../utils';

export function createAgentApp({
  chatHandler,
  chatRateLimiter,
  clearHandler,
  clearRateLimiter,
  feedbackHandler,
  feedbackRateLimiter,
  widgetCorsOrigin,
  widgetDistPath
}: {
  chatHandler: RequestHandler;
  chatRateLimiter?: RequestHandler;
  clearHandler: RequestHandler;
  clearRateLimiter?: RequestHandler;
  feedbackHandler: RequestHandler;
  feedbackRateLimiter?: RequestHandler;
  widgetCorsOrigin: string;
  widgetDistPath: string;
}) {
  const app = express();

  app.use(express.json({ limit: '200kb' }));

  app.use('/widget', (_request, response, next) => {
    response.header('Access-Control-Allow-Origin', widgetCorsOrigin);
    response.header('Vary', 'Origin');
    next();
  });

  if (existsSync(widgetDistPath)) {
    app.use('/widget', express.static(widgetDistPath));
  } else {
    app.get('/widget/:asset', (_request, response) => {
      response.status(503).json({
        error: 'WIDGET_ASSETS_UNAVAILABLE',
        message: `Widget assets not found at ${widgetDistPath}. Run: npx esbuild apps/agent/widget/index.ts --bundle --format=esm --outfile=dist/apps/agent/widget/index.js`
      });
    });
  }

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/chat/clear', clearRateLimiter ?? ((_req, _res, next) => next()), clearHandler);
  app.post('/chat', chatRateLimiter ?? ((_req, _res, next) => next()), chatHandler);
  app.post('/feedback', feedbackRateLimiter ?? ((_req, _res, next) => next()), feedbackHandler);

  return app;
}

export function resolveWidgetRuntimeConfig(cwd: string, distPathEnv?: string, corsOriginEnv?: string) {
  return {
    widgetCorsOrigin: resolveWidgetCorsOrigin(corsOriginEnv),
    widgetDistPath: resolveWidgetDistPath(cwd, distPathEnv)
  };
}
