import 'dotenv/config';

import { logger } from './logger';

// Process-level crash handlers so production stays up and failures are visible in logs.
// Unhandled rejections are logged and do not exit; uncaught exceptions log and exit after a short delay.
function installCrashHandlers(): void {
  process.on('unhandledRejection', (reason, promise) => {
    // eslint-disable-next-line no-console
    console.error('[agent] UNHANDLED_REJECTION', { reason, promise: String(promise) });
    logger.error('[agent] UNHANDLED_REJECTION', { reason, promise: String(promise) });
  });

  process.on('uncaughtException', (error) => {
    // eslint-disable-next-line no-console
    console.error('[agent] UNCAUGHT_EXCEPTION', error?.message ?? String(error), error?.stack ?? '');
    logger.error('[agent] UNCAUGHT_EXCEPTION', error?.message ?? String(error), error?.stack ?? '');
    // Allow logs to flush, then exit so the process manager can restart.
    setTimeout(() => process.exit(1), 1000);
  });
}

installCrashHandlers();

import { createAgent } from './agent';
import { createConversationStoreFromEnv } from './conversation-store';
import { createDefaultContextManager } from './context-manager';
import { createFeedbackStoreFromEnv } from './feedback-store';
import { createRegulationStoreFromEnv } from './regulation-store';
import { GhostfolioClient } from './ghostfolio-client';
import { createOpenAiClientFromEnv } from './openai-client';
import { createAgentApp, resolveWidgetRuntimeConfig } from './http/app-factory';
import { createChatHandler } from './http/chat-handler';
import { createClearHandler } from './http/clear-handler';
import { createFeedbackHandler } from './http/feedback-handler';
import { createRateLimitMiddleware } from './http/rate-limit';
import { analyzeStockTrendTool } from './tools/analyze-stock-trend';
import { complianceCheckTool } from './tools/compliance-check';
import { createOrderTool } from './tools/create-order';
import { createOtherActivitiesTool } from './tools/create-other-activities';
import { factCheckTool } from './tools/fact-check';
import { factComplianceCheckTool } from './tools/fact-compliance-check';
import { getOrdersTool } from './tools/get-orders';
import { getTransactionsTool } from './tools/get-transactions';
import { holdingsAnalysisTool } from './tools/holdings-analysis';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { marketDataTool } from './tools/market-data';
import { marketOverviewTool } from './tools/market-overview';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { staticAnalysisTool } from './tools/static-analysis';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { transactionTimelineTool } from './tools/transaction-timeline';
import {
  createToolResponseCacheStoreFromEnv,
  withToolResponseCache
} from './tool-response-cache';

const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? '4444');
const host = process.env.HOST ?? '0.0.0.0';
const ghostfolioBaseUrl = process.env.GHOSTFOLIO_BASE_URL?.trim() || 'http://localhost:3333';

if (process.env.GHOSTFOLIO_BASE_URL === undefined || process.env.GHOSTFOLIO_BASE_URL === '') {
  logger.info('[agent] GHOSTFOLIO_BASE_URL not set, using fallback base URL:', ghostfolioBaseUrl);
} else {
  logger.info('[agent] GHOSTFOLIO_BASE_URL=', ghostfolioBaseUrl);
}

const llm = createOpenAiClientFromEnv();
if (!llm) {
  logger.warn(
    '[agent] No LLM configured (OPENAI_API_KEY or OPENROUTER_API_KEY). Agent will run with limited direct answers and no tool routing.'
  );
}
const allowBodyAccessToken = false;
const allowInsecureGhostfolioHttp = process.env.AGENT_ALLOW_INSECURE_GHOSTFOLIO_HTTP === 'true';
const ghostfolioAllowedHosts = (process.env.AGENT_GHOSTFOLIO_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((hostName) => hostName.trim())
  .filter(Boolean);

try {
  const feedbackStore = createFeedbackStoreFromEnv();
  const regulationStore = createRegulationStoreFromEnv();
  if (process.env.AGENT_REGULATION_SEED_ON_START === 'true') {
    regulationStore.seedTopics().then((r) => {
      if (r.error) logger.warn('[agent] regulation seed on start failed:', r.error);
      else logger.info('[agent] regulation topics seeded:', r.seeded);
    });
  }
  const enableFeedbackMemory = process.env.AGENT_ENABLE_FEEDBACK_MEMORY !== 'false';

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

  const conversationStore = createConversationStoreFromEnv({
    redisUrl: process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL,
    storeType: process.env.AGENT_CONVERSATION_STORE,
    ttlMs: parsePositiveInteger(process.env.AGENT_CONVERSATION_TTL_MS)
  });

const contextManager = createDefaultContextManager({
  maxRecentMessages: parsePositiveInteger(process.env.AGENT_CONTEXT_WINDOW_MAX_MESSAGES) ?? 10,
  summarySampleMessages:
    parsePositiveInteger(process.env.AGENT_CONTEXT_SUMMARY_SAMPLE_MESSAGES) ?? 6
});
const chatRateLimitMax = parsePositiveInteger(process.env.AGENT_CHAT_RATE_LIMIT_MAX) ?? 60;
const chatRateLimitWindowMs =
  parsePositiveInteger(process.env.AGENT_CHAT_RATE_LIMIT_WINDOW_MS) ?? 60_000;
const clearRateLimitMax = parsePositiveInteger(process.env.AGENT_CLEAR_RATE_LIMIT_MAX) ?? 30;
const clearRateLimitWindowMs =
  parsePositiveInteger(process.env.AGENT_CLEAR_RATE_LIMIT_WINDOW_MS) ?? 60_000;
const feedbackRateLimitMax =
  parsePositiveInteger(process.env.AGENT_FEEDBACK_RATE_LIMIT_MAX) ?? 120;
const feedbackRateLimitWindowMs =
  parsePositiveInteger(process.env.AGENT_FEEDBACK_RATE_LIMIT_WINDOW_MS) ?? 60_000;
const toolResponseCache = createToolResponseCacheStoreFromEnv({
  redisUrl: process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL
});
const toolResponseCacheTtlMs =
  parsePositiveInteger(process.env.AGENT_TOOL_CACHE_TTL_MS) ?? 15_000;

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

function createAgentWithClient(ghostfolioClient: GhostfolioClient) {
  return createAgent({
    contextManager,
    conversationStore,
    ...(enableFeedbackMemory ? { feedbackMemoryProvider: feedbackStore } : {}),
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
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { message, createOrderParams, regulations },
          task: () =>
            complianceCheckTool({
              createOrderParams,
              llmFactExtractor: llm?.extractComplianceFacts,
              message,
              regulations
            }),
          toolName: 'compliance_check',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      factCheck: (a, b) => {
        const { impersonationId, message, symbols, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, symbols, token },
          task: () =>
            factCheckTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              symbols,
              token
            }),
          toolName: 'fact_check',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      factComplianceCheck: (a, b) => {
        const {
          createOrderParams,
          impersonationId,
          message,
          regulations,
          symbols,
          token,
          type
        } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: {
            createOrderParams,
            impersonationId,
            message,
            regulations,
            symbols,
            token,
            type
          },
          task: () =>
            factComplianceCheckTool({
              client: ghostfolioClient,
              createOrderParams,
              impersonationId,
              llmFactExtractor: llm?.extractComplianceFacts,
              message,
              regulationStore,
              regulations,
              symbols,
              token,
              type
            }),
          toolName: 'fact_compliance_check',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      marketData: (a, b) => {
        const { impersonationId, message, metrics, symbols, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, metrics, symbols, token },
          task: () =>
            marketDataTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              metrics,
              symbols,
              token
            }),
          toolName: 'market_data',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      analyzeStockTrend: (a, b) => {
        const { impersonationId, message, range, symbol, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, range, symbol, token },
          task: () =>
            analyzeStockTrendTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              range,
              symbol,
              token
            }),
          toolName: 'analyze_stock_trend',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      marketDataLookup: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            marketDataLookupTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'market_data_lookup',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      marketOverview: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            marketOverviewTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'market_overview',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      portfolioAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            portfolioAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'portfolio_analysis',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      holdingsAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            holdingsAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'holdings_analysis',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      staticAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            staticAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'static_analysis',
          ttlMs: toolResponseCacheTtlMs
        });
      },
      transactionCategorize: (a, b) => {
        const {
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type
        } = toolInput(a, b);
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
        const {
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type,
          wantsLatest
        } = toolInput(a, b);
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

  const { widgetCorsOrigin, widgetDistPath } = resolveWidgetRuntimeConfig(
    process.cwd(),
    process.env.AGENT_WIDGET_DIST_PATH,
    process.env.AGENT_WIDGET_CORS_ORIGIN
  );

  const app = createAgentApp({
    chatHandler: createChatHandler({
      allowBodyAccessToken,
      allowInsecureGhostfolioHttp,
      createAgentWithClient,
      ghostfolioAllowedHosts,
      ghostfolioBaseUrl
    }),
    chatRateLimiter: createRateLimitMiddleware({
      maxRequests: chatRateLimitMax,
      windowMs: chatRateLimitWindowMs
    }),
    clearHandler: createClearHandler({
      allowBodyAccessToken,
      conversationStore
    }),
    clearRateLimiter: createRateLimitMiddleware({
      maxRequests: clearRateLimitMax,
      windowMs: clearRateLimitWindowMs
    }),
    feedbackHandler: createFeedbackHandler({
      feedbackStore
    }),
    feedbackRateLimiter: createRateLimitMiddleware({
      maxRequests: feedbackRateLimitMax,
      windowMs: feedbackRateLimitWindowMs
    }),
    widgetCorsOrigin,
    widgetDistPath
  });
  app.listen(port, host, () => {
    logger.info(`[agent] listening on http://${host}:${port}`);
  });
} catch (startupError) {
  const message =
    startupError instanceof Error ? startupError.message : String(startupError);
  const stack = startupError instanceof Error ? startupError.stack : undefined;
  // eslint-disable-next-line no-console
  console.error('[agent] STARTUP_FAILED', message, stack ?? '');
  logger.error('[agent] STARTUP_FAILED', message, stack ?? '');
  process.exitCode = 1;
  process.exit(1);
}
