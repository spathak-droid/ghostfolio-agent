import 'dotenv/config';

import express from 'express';
import { existsSync } from 'fs';

import { createAgent } from './agent';
import {
  parseCreateOrderParams,
  validateChatBody,
  validateImpersonationId,
  validateTokenLength
} from './chat-request-validation';
import { createConversationStoreFromEnv } from './conversation-store';
import { createDefaultContextManager } from './context-manager';
import { resolveGhostfolioBaseUrl } from './ghostfolio-base-url';
import { GhostfolioClient } from './ghostfolio-client';
import { createOpenAiClientFromEnv } from './openai-client';
import { resolveRequestToken } from './request-auth';
import { createOrderTool } from './tools/create-order';
import { createOtherActivitiesTool } from './tools/create-other-activities';
import { complianceCheckTool } from './tools/compliance-check';
import { getOrdersTool } from './tools/get-orders';
import { getTransactionsTool } from './tools/get-transactions';
import { marketDataTool } from './tools/market-data';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { marketOverviewTool } from './tools/market-overview';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { transactionTimelineTool } from './tools/transaction-timeline';
import { logger } from './logger';
import { resolveWidgetCorsOrigin, resolveWidgetDistPath } from './widget-static';

const app = express();
// Railway and similar platforms set PORT; fall back to AGENT_PORT for local dev
const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? '4444');
const ghostfolioBaseUrl = process.env.GHOSTFOLIO_BASE_URL?.trim() || 'http://localhost:3333';
if (process.env.GHOSTFOLIO_BASE_URL === undefined || process.env.GHOSTFOLIO_BASE_URL === '') {
  logger.info('[agent] GHOSTFOLIO_BASE_URL not set, using fallback base URL:', ghostfolioBaseUrl);
} else {
  logger.info('[agent] GHOSTFOLIO_BASE_URL=', ghostfolioBaseUrl);
}
const widgetDistPath = resolveWidgetDistPath(
  process.cwd(),
  process.env.AGENT_WIDGET_DIST_PATH
);
const widgetCorsOrigin = resolveWidgetCorsOrigin(process.env.AGENT_WIDGET_CORS_ORIGIN);
const llm = createOpenAiClientFromEnv();
const allowBodyAccessToken = false;
const allowInsecureGhostfolioHttp =
  process.env.AGENT_ALLOW_INSECURE_GHOSTFOLIO_HTTP === 'true';
const ghostfolioAllowedHosts = (
  process.env.AGENT_GHOSTFOLIO_ALLOWED_HOSTS ?? ''
)
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

// traceable() calls the tool with (runtimeTrace, input); use second arg when present so token is passed
function toolInput(
  a: unknown,
  b?: {
    impersonationId?: string;
    message: string;
    regulations?: string[];
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
  }
): {
  impersonationId?: string;
  message: string;
  regulations?: string[];
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
} {
  if (b && typeof b.message === 'string') return b;
  return a as {
    impersonationId?: string;
    message: string;
    regulations?: string[];
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
  };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}
// Tool Registry execution wiring: each tool in TOOL_DEFINITIONS is implemented below and passed to the agent.
const conversationStore = createConversationStoreFromEnv({
  redisUrl: process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL,
  storeType: process.env.AGENT_CONVERSATION_STORE,
  ttlMs: parsePositiveInteger(process.env.AGENT_CONVERSATION_TTL_MS)
});
const contextManager = createDefaultContextManager({
  maxRecentMessages:
    parsePositiveInteger(process.env.AGENT_CONTEXT_WINDOW_MAX_MESSAGES) ?? 10,
  summarySampleMessages:
    parsePositiveInteger(process.env.AGENT_CONTEXT_SUMMARY_SAMPLE_MESSAGES) ?? 6
});
function createAgentWithClient(ghostfolioClient: GhostfolioClient) {
  return createAgent({
  contextManager,
  conversationStore,
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
    complianceCheck: (a, b) => {
      const { message, createOrderParams, regulations } = toolInput(a, b);
      return complianceCheckTool({
        createOrderParams,
        llmFactExtractor: llm?.extractComplianceFacts,
        message,
        regulations
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
    createOtherActivities: (a, b) => {
      const { impersonationId, message, token, createOrderParams } = toolInput(a, b);
      return createOtherActivitiesTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token,
        createOrderParams
      });
    },
    getOrders: (a, b) => {
      const { impersonationId, message, token } = toolInput(a, b);
      return getOrdersTool({
        client: ghostfolioClient,
        impersonationId,
        message,
        token
      });
    }
  }
});
}

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

app.post('/chat', async (request, response) => {
  const requestBody =
    request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};
  const hasTokenFromHeader = Boolean(request.headers.authorization);
  const hasTokenFromBody = Boolean(
    typeof requestBody.accessToken === 'string' && requestBody.accessToken.trim()
  );
  const tokenResolution = resolveRequestToken({
    allowBodyAccessToken,
    authorizationHeader: request.headers.authorization,
    bodyAccessToken:
      typeof requestBody.accessToken === 'string'
        ? requestBody.accessToken
        : undefined
  });
  if (!tokenResolution.ok) {
    const err = tokenResolution as { status: 400; error: string };
    response
      .status(err.status)
      .json({ error: err.error, code: 'VALIDATION_ERROR' });
    return;
  }
  const token = tokenResolution.token;
  const impersonationId =
    typeof request.headers['impersonation-id'] === 'string'
      ? request.headers['impersonation-id']
      : undefined;
  const impersonationValidation = validateImpersonationId(impersonationId);
  if (!impersonationValidation.ok) {
    const err = impersonationValidation as { status: 400; error: string };
    response
      .status(err.status)
      .json({ error: err.error, code: 'VALIDATION_ERROR' });
    return;
  }

  const tokenCheck = validateTokenLength(token);
  if (!tokenCheck.ok) {
    const err = tokenCheck as { status: 400; error: string };
    response.status(err.status).json({ error: err.error, code: 'VALIDATION_ERROR' });
    return;
  }

  const validation = validateChatBody(requestBody);
  if (!validation.ok) {
    const err = validation as { status: 400; error: string };
    response.status(err.status).json({ error: err.error, code: 'VALIDATION_ERROR' });
    return;
  }

  const ghostfolioBaseUrlResolution = resolveGhostfolioBaseUrl({
    allowedHosts: ghostfolioAllowedHosts,
    allowInsecureHttp: allowInsecureGhostfolioHttp,
    configuredBaseUrl: process.env.GHOSTFOLIO_BASE_URL,
    fallbackBaseUrl: ghostfolioBaseUrl
  });
  if (!ghostfolioBaseUrlResolution.ok) {
    const err = ghostfolioBaseUrlResolution as { status: 500; error: string };
    response.status(err.status).json({
      error: err.error,
      code: 'CONFIGURATION_ERROR'
    });
    return;
  }
  const resolvedGhostfolioBaseUrl = ghostfolioBaseUrlResolution.url;
  const requestAgent = createAgentWithClient(new GhostfolioClient(resolvedGhostfolioBaseUrl));
  logger.debug('[agent-auth] Agent received:', {
    hasTokenFromHeader,
    hasTokenFromBody,
    hasToken: Boolean(token),
    ghostfolioBaseUrl: resolvedGhostfolioBaseUrl
  });

  try {
    const createOrderParamsResult = parseCreateOrderParams(requestBody.createOrderParams);
    if (!createOrderParamsResult.ok) {
      const err = createOrderParamsResult as { status: 400; error: string };
      response
        .status(err.status)
        .json({ error: err.error, code: 'VALIDATION_ERROR' });
      return;
    }

    const chatResponse = await requestAgent.chat({
      ...validation.params,
      createOrderParams: createOrderParamsResult.params,
      impersonationId: impersonationValidation.value,
      token
    });

    response.status(200).json(chatResponse);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unhandled agent.chat failure';
    logger.error('[agent.chat] UNHANDLED_ERROR', { message });
    response.status(500).json({
      answer: 'Something went wrong. Please try again.',
      error: 'AGENT_CHAT_FAILED'
    });
  }
});

const host = process.env.HOST ?? '0.0.0.0';
app.listen(port, host, () => {
  logger.info(`[agent] listening on http://${host}:${port}`);
});
