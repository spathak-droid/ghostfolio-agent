import 'dotenv/config';

import express from 'express';
import { existsSync } from 'fs';
import { appendFileSync } from 'fs';
import { join } from 'path';

import { createAgent } from './agent';
import { normalizeAuthToken } from './auth-token';
import { GhostfolioClient } from './ghostfolio-client';
import { createOpenAiClientFromEnv } from './openai-client';
import { createOrderTool } from './tools/create-order';
import { getTransactionsTool } from './tools/get-transactions';
import { marketDataTool } from './tools/market-data';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { marketOverviewTool } from './tools/market-overview';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { transactionTimelineTool } from './tools/transaction-timeline';
import { updateOrderTool } from './tools/update-order';
import { resolveWidgetCorsOrigin, resolveWidgetDistPath } from './widget-static';

const app = express();
// Railway and similar platforms set PORT; fall back to AGENT_PORT for local dev
const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? '4444');
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
    dateFrom?: string;
    dateTo?: string;
    metrics?: string[];
    range?: string;
    symbol?: string;
    symbols?: string[];
    take?: number;
    token?: string;
    transactions?: Record<string, unknown>[];
    type?: string;
    wantsLatest?: boolean;
    createOrderParams?: import('./types').CreateOrderParams;
    updateOrderParams?: import('./types').UpdateOrderParams;
  }
): {
  impersonationId?: string;
  message: string;
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  token?: string;
  transactions?: Record<string, unknown>[];
  type?: string;
  wantsLatest?: boolean;
  createOrderParams?: import('./types').CreateOrderParams;
  updateOrderParams?: import('./types').UpdateOrderParams;
} {
  if (b && typeof b.message === 'string') return b;
  return a as {
    impersonationId?: string;
    message: string;
    dateFrom?: string;
    dateTo?: string;
    metrics?: string[];
    range?: string;
    symbol?: string;
    symbols?: string[];
    take?: number;
    token?: string;
    transactions?: Record<string, unknown>[];
    type?: string;
    wantsLatest?: boolean;
    createOrderParams?: import('./types').CreateOrderParams;
    updateOrderParams?: import('./types').UpdateOrderParams;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseCreateOrderParams(value: unknown): import('./types').CreateOrderParams | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.symbol !== 'string' || typeof value.type !== 'string') return undefined;

  const parsed: import('./types').CreateOrderParams = {
    symbol: value.symbol,
    type: value.type as import('./types').OrderType
  };

  if (typeof value.quantity === 'number') parsed.quantity = value.quantity;
  if (typeof value.unitPrice === 'number') parsed.unitPrice = value.unitPrice;
  if (typeof value.date === 'string') parsed.date = value.date;
  if (typeof value.currency === 'string') parsed.currency = value.currency;
  if (typeof value.fee === 'number') parsed.fee = value.fee;
  if (typeof value.accountId === 'string') parsed.accountId = value.accountId;
  if (typeof value.dataSource === 'string') parsed.dataSource = value.dataSource;
  if (typeof value.comment === 'string') parsed.comment = value.comment;

  return parsed;
}

function parseUpdateOrderParams(value: unknown): import('./types').UpdateOrderParams | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.orderId !== 'string') return undefined;

  const parsed: import('./types').UpdateOrderParams = {
    orderId: value.orderId
  };

  if (typeof value.date === 'string') parsed.date = value.date;
  if (typeof value.quantity === 'number') parsed.quantity = value.quantity;
  if (typeof value.unitPrice === 'number') parsed.unitPrice = value.unitPrice;
  if (typeof value.fee === 'number') parsed.fee = value.fee;
  if (typeof value.currency === 'string') parsed.currency = value.currency;
  if (typeof value.symbol === 'string') parsed.symbol = value.symbol;
  if (typeof value.type === 'string') parsed.type = value.type;
  if (typeof value.dataSource === 'string') parsed.dataSource = value.dataSource;
  if (typeof value.accountId === 'string') parsed.accountId = value.accountId;
  if (typeof value.comment === 'string') parsed.comment = value.comment;
  if (Array.isArray(value.tags)) {
    parsed.tags = value.tags.filter((tag): tag is string => typeof tag === 'string');
  }

  return parsed;
}
// Tool Registry execution wiring: each tool in TOOL_DEFINITIONS is implemented below and passed to the agent.
const agent = createAgent({
  llm,
  tools: {
    getTransactions: (a, b) => {
      const { impersonationId, message, range, take, token } = toolInput(a, b);
      return getTransactionsTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        range,
        take,
        token
      });
    },
    marketData: (a, b) => {
      const { impersonationId, message, metrics, symbols, token } = toolInput(a, b);
      return marketDataTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        metrics,
        symbols,
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
    marketOverview: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return marketOverviewTool({
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
      const { dateFrom, dateTo, impersonationId, message, symbol, token, transactions, type } = toolInput(a, b);
      return transactionCategorizeTool({
        dateFrom,
        dateTo,
        impersonationId,
        message,
        symbol,
        token,
        transactions,
        type
      });
    },
    transactionTimeline: (a, b) => {
      const { dateFrom, dateTo, impersonationId, message, symbol, token, transactions, type, wantsLatest } = toolInput(a, b);
      return transactionTimelineTool({
        dateFrom,
        dateTo,
        impersonationId,
        message,
        symbol,
        token,
        transactions,
        type,
        wantsLatest
      });
    },
    createOrder: (a, b) => {
      const { impersonationId, message, token, createOrderParams } = toolInput(a, b);
      return createOrderTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token,
        createOrderParams
      });
    },
    updateOrder: (a, b) => {
      const { impersonationId, message, token, updateOrderParams } = toolInput(a, b);
      return updateOrderTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token,
        updateOrderParams
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
    createOrderParams: parseCreateOrderParams(request.body?.createOrderParams),
    dateFrom:
      typeof request.body?.dateFrom === 'string' ? request.body.dateFrom : undefined,
    dateTo: typeof request.body?.dateTo === 'string' ? request.body.dateTo : undefined,
    impersonationId,
    metrics: Array.isArray(request.body?.metrics)
      ? request.body.metrics.filter((item: unknown): item is string => typeof item === 'string')
      : undefined,
    message: request.body.message,
    range: typeof request.body?.range === 'string' ? request.body.range : undefined,
    symbol: typeof request.body?.symbol === 'string' ? request.body.symbol : undefined,
    symbols: Array.isArray(request.body?.symbols)
      ? request.body.symbols.filter((item: unknown): item is string => typeof item === 'string')
      : undefined,
    take: typeof request.body?.take === 'number' ? request.body.take : undefined,
    token,
    type: typeof request.body?.type === 'string' ? request.body.type : undefined,
    updateOrderParams: parseUpdateOrderParams(request.body?.updateOrderParams),
    wantsLatest: typeof request.body?.wantsLatest === 'boolean' ? request.body.wantsLatest : undefined
  });

  response.status(200).json(chatResponse);
});

const host = process.env.HOST ?? '0.0.0.0';
app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[agent] listening on http://${host}:${port}`);
});
