/**
 * Server configuration: Environment setup, stores, and rate limits.
 * Centralizes all startup configuration in one place.
 */

import { logger } from './utils';
import {
  createConversationStoreFromEnv,
  createConversationHistoryStoreFromEnv,
  createFeedbackStoreFromEnv,
  createRegulationStoreFromEnv,
  createToolResponseCacheStoreFromEnv
} from './stores';
import { createOpenAiClientFromEnv } from './llm';
import { createDefaultContextManager } from './agent';

function parsePositiveInteger(value: string | undefined, max?: number): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  const floored = Math.floor(parsed);
  if (max !== undefined && floored > max) {
    return undefined;
  }

  return floored;
}

export interface ServerConfig {
  port: number;
  host: string;
  ghostfolioBaseUrl: string;
  llm: ReturnType<typeof createOpenAiClientFromEnv>;
  allowBodyAccessToken: boolean;
  allowInsecureGhostfolioHttp: boolean;
  ghostfolioAllowedHosts: string[];
  feedbackStore: ReturnType<typeof createFeedbackStoreFromEnv>;
  regulationStore: ReturnType<typeof createRegulationStoreFromEnv>;
  enableFeedbackMemory: boolean;
  conversationStore: ReturnType<typeof createConversationStoreFromEnv>;
  conversationHistoryStore: ReturnType<typeof createConversationHistoryStoreFromEnv>;
  contextManager: ReturnType<typeof createDefaultContextManager>;
  chatRateLimitMax: number;
  chatRateLimitWindowMs: number;
  clearRateLimitMax: number;
  clearRateLimitWindowMs: number;
  feedbackRateLimitMax: number;
  feedbackRateLimitWindowMs: number;
  historyRateLimitMax: number;
  historyRateLimitWindowMs: number;
  toolResponseCache: ReturnType<typeof createToolResponseCacheStoreFromEnv>;
  toolResponseCacheTtlMs: number;
}

export function buildServerConfig(): ServerConfig {
  const port = parsePositiveInteger(process.env.PORT ?? process.env.AGENT_PORT, 65535) ?? 4444;
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

  const feedbackStore = createFeedbackStoreFromEnv();
  const regulationStore = createRegulationStoreFromEnv();
  if (process.env.AGENT_REGULATION_SEED_ON_START === 'true') {
    regulationStore.seedTopics().then((r) => {
      if (r.error) logger.warn('[agent] regulation seed on start failed:', r.error);
      else logger.info('[agent] regulation topics seeded:', r.seeded);
    }).catch((err: unknown) => {
      logger.warn('[agent] regulation seed threw unexpectedly:', err instanceof Error ? err.message : String(err));
    });
  }
  const enableFeedbackMemory = process.env.AGENT_ENABLE_FEEDBACK_MEMORY !== 'false';

  const conversationStore = createConversationStoreFromEnv({
    redisUrl: process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL,
    storeType: process.env.AGENT_CONVERSATION_STORE,
    ttlMs: parsePositiveInteger(process.env.AGENT_CONVERSATION_TTL_MS)
  });

  const conversationHistoryStore = createConversationHistoryStoreFromEnv();

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
  const historyRateLimitMax =
    parsePositiveInteger(process.env.AGENT_HISTORY_RATE_LIMIT_MAX) ?? 60;
  const historyRateLimitWindowMs =
    parsePositiveInteger(process.env.AGENT_HISTORY_RATE_LIMIT_WINDOW_MS) ?? 60_000;

  const toolResponseCache = createToolResponseCacheStoreFromEnv({
    redisUrl: process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL
  });
  const toolResponseCacheTtlMs =
    parsePositiveInteger(process.env.AGENT_TOOL_CACHE_TTL_MS) ?? 15_000;

  return {
    port,
    host,
    ghostfolioBaseUrl,
    llm,
    allowBodyAccessToken,
    allowInsecureGhostfolioHttp,
    ghostfolioAllowedHosts,
    feedbackStore,
    regulationStore,
    enableFeedbackMemory,
    conversationStore,
    conversationHistoryStore,
    contextManager,
    chatRateLimitMax,
    chatRateLimitWindowMs,
    clearRateLimitMax,
    clearRateLimitWindowMs,
    feedbackRateLimitMax,
    feedbackRateLimitWindowMs,
    historyRateLimitMax,
    historyRateLimitWindowMs,
    toolResponseCache,
    toolResponseCacheTtlMs
  };
}
