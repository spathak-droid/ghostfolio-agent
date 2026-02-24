import express from 'express';
import { existsSync } from 'fs';

import { createAgent } from './agent';
import { GhostfolioClient } from './ghostfolio-client';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { resolveWidgetCorsOrigin, resolveWidgetDistPath } from './widget-static';

const app = express();
const port = Number(process.env.AGENT_PORT ?? '4444');
const ghostfolioBaseUrl = process.env.GHOSTFOLIO_BASE_URL ?? 'http://localhost:3333';
const widgetDistPath = resolveWidgetDistPath(
  process.cwd(),
  process.env.AGENT_WIDGET_DIST_PATH
);
const widgetCorsOrigin = resolveWidgetCorsOrigin(process.env.AGENT_WIDGET_CORS_ORIGIN);
const ghostfolioClient = new GhostfolioClient(ghostfolioBaseUrl);

const agent = createAgent({
  tools: {
    marketDataLookup: ({ message, token }) => {
      return marketDataLookupTool({ client: ghostfolioClient, message, token });
    },
    portfolioAnalysis: ({ message, token }) => {
      return portfolioAnalysisTool({ client: ghostfolioClient, message, token });
    },
    transactionCategorize: ({ message, token }) => {
      return transactionCategorizeTool({ message, token });
    }
  }
});

app.use(express.json());

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

app.post('/chat', async (request, response) => {
  const bearerHeader = request.headers.authorization;
  const token = bearerHeader?.startsWith('Bearer ')
    ? bearerHeader.slice('Bearer '.length)
    : undefined;

  const chatResponse = await agent.chat({
    conversationId: request.body.conversationId,
    message: request.body.message,
    token
  });

  response.status(200).json(chatResponse);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[agent] listening on http://localhost:${port}`);
});
