import 'dotenv/config';

import express from 'express';
import { existsSync } from 'fs';
import { appendFileSync } from 'fs';
import { join } from 'path';

import { createAgent } from './agent';
import { normalizeAuthToken } from './auth-token';
import { GhostfolioClient } from './ghostfolio-client';
import { createOpenAiClientFromEnv } from './openai-client';
import { getTransactionsTool } from './tools/get-transactions';
import { marketDataTool } from './tools/market-data';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { transactionTimelineTool } from './tools/transaction-timeline';
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
const llm = createOpenAiClientFromEnv();

// traceable() calls the tool with (runtimeTrace, input); use second arg when present so token is passed
function toolInput(
  a: unknown,
  b?: {
    impersonationId?: string;
    message: string;
    token?: string;
    transactions?: Record<string, unknown>[];
  }
): {
  impersonationId?: string;
  message: string;
  token?: string;
  transactions?: Record<string, unknown>[];
} {
  if (b && typeof b.message === 'string') return b;
  return a as {
    impersonationId?: string;
    message: string;
    token?: string;
    transactions?: Record<string, unknown>[];
  };
}
// Tool Registry execution wiring: each tool in TOOL_DEFINITIONS is implemented below and passed to the agent.
const agent = createAgent({
  llm,
  tools: {
    getTransactions: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return getTransactionsTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token
      });
    },
    marketData: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return marketDataTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token
      });
    },
    marketDataLookup: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return marketDataLookupTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token
      });
    },
    portfolioAnalysis: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return portfolioAnalysisTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token
      });
    },
    transactionCategorize: (a, b) => {
      const { impersonationId, message, token, transactions } = toolInput(a, b);
      return transactionCategorizeTool({
        impersonationId,
        message,
        token,
        transactions
      });
    },
    transactionTimeline: (a, b) => {
      const { impersonationId, message, token, transactions } = toolInput(a, b);
      return transactionTimelineTool({
        impersonationId,
        message,
        token,
        transactions
      });
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
  const hasTokenFromHeader = Boolean(request.headers.authorization);
  const hasTokenFromBody = Boolean(
    typeof request.body?.accessToken === 'string' && request.body.accessToken.trim()
  );
  const token =
    normalizeAuthToken(request.headers.authorization) ??
    (typeof request.body?.accessToken === 'string' && request.body.accessToken.trim()
      ? request.body.accessToken.trim()
      : undefined);
  const impersonationId =
    typeof request.headers['impersonation-id'] === 'string'
      ? request.headers['impersonation-id']
      : undefined;

  // #region agent log
  try {
    const logPath = join(process.cwd(), '.cursor', 'debug-af2e79.log');
    appendFileSync(
      logPath,
      JSON.stringify({
        location: 'agent/index.ts:chat',
        message: 'agent received request',
        hasTokenFromHeader,
        hasTokenFromBody,
        hasToken: Boolean(token),
        ghostfolioBaseUrl,
        timestamp: Date.now()
      }) + '\n'
    );
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.log('[agent-auth] Agent received:', {
    hasTokenFromHeader,
    hasTokenFromBody,
    hasToken: Boolean(token),
    ghostfolioBaseUrl
  });
  // #endregion

  const chatResponse = await agent.chat({
    conversationId: request.body.conversationId,
    impersonationId,
    message: request.body.message,
    token
  });

  response.status(200).json(chatResponse);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[agent] listening on http://localhost:${port}`);
});
