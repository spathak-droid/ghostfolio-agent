import express from 'express';
import { existsSync } from 'fs';
import type { RequestHandler } from 'express';

import { resolveWidgetCorsOrigin, resolveWidgetDistPath } from '../widget-static';

export function createAgentApp({
  chatHandler,
  clearHandler,
  feedbackHandler,
  widgetCorsOrigin,
  widgetDistPath
}: {
  chatHandler: RequestHandler;
  clearHandler: RequestHandler;
  feedbackHandler: RequestHandler;
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

  app.post('/chat/clear', clearHandler);
  app.post('/chat', chatHandler);
  app.post('/feedback', feedbackHandler);

  return app;
}

export function resolveWidgetRuntimeConfig(cwd: string, distPathEnv?: string, corsOriginEnv?: string) {
  return {
    widgetCorsOrigin: resolveWidgetCorsOrigin(corsOriginEnv),
    widgetDistPath: resolveWidgetDistPath(cwd, distPathEnv)
  };
}
