/**
 * Purpose: OpenAI/OpenRouter LLM client factory and env-based creation.
 * Method implementations live in openai-client-impl.ts; cache/parse helpers in openai-client-cache.ts.
 */

import type { AgentTraceContext } from '../types';
import {
  formatToolsForLlm,
  getSelectableToolDefinitions,
  SELECTABLE_TOOL_NAMES,
  type ToolDefinition
} from '../tools/tool-registry';
import { logger } from '../utils';
import { isValidAbsoluteHttpUrl } from './openai-client-helpers';
import { callOpenAi } from './openai-client-request';
import { createLlmCacheStoreFromEnv, type LlmCacheStore } from './llm-cache';
import { normalizePositiveInt } from './openai-client-cache';
import { createLlmImplementation } from './openai-client-impl';
import type { AgentLlm } from '../types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LLM_REQUEST_TIMEOUT_MS = 25_000;

/** Valid tool names for parsing LLM JSON (from registry). */
const TOOL_NAMES_FOR_PARSE = [...SELECTABLE_TOOL_NAMES] as import('../types').AgentToolName[];

export function createOpenAiClient({
  apiKey,
  cache,
  cacheTtlSeconds = {},
  model,
  modelFallbacks = {},
  models,
  requestUrl = OPENAI_URL,
  toolDefinitions = getSelectableToolDefinitions()
}: {
  apiKey: string;
  cache?: LlmCacheStore;
  cacheTtlSeconds?: Partial<Record<'extractComplianceFacts' | 'selectTool', number>>;
  model: string;
  modelFallbacks?: Partial<Record<'balanced' | 'fast' | 'premium', string[]>>;
  models?: Partial<Record<'balanced' | 'fast' | 'premium', string>>;
  requestUrl?: string;
  toolDefinitions?: readonly ToolDefinition[];
}): AgentLlm {
  const toolsDescription = formatToolsForLlm(toolDefinitions);
  const toolList = toolDefinitions.map((d) => d.name).join('|');
  const tierModels: Record<'balanced' | 'fast' | 'premium', string> = {
    balanced: models?.balanced ?? model,
    fast: models?.fast ?? model,
    premium: models?.premium ?? model
  };
  const effectiveCacheTtlSeconds = {
    extractComplianceFacts: normalizePositiveInt(cacheTtlSeconds.extractComplianceFacts, 300),
    selectTool: normalizePositiveInt(cacheTtlSeconds.selectTool, 120)
  };

  const callByTier = async ({
    messages,
    requireJson,
    tier,
    traceContext
  }: {
    messages: { role: 'assistant' | 'system' | 'user'; content: string }[];
    requireJson: boolean;
    tier: 'balanced' | 'fast' | 'premium';
    traceContext?: AgentTraceContext;
  }) => {
    const modelSequence = [tierModels[tier], ...(modelFallbacks[tier] ?? [])];
    let lastError: unknown;

    for (const [candidateIndex, candidateModel] of modelSequence.entries()) {
      try {
        return await callOpenAi({
          apiKey,
          candidateIndex,
          messages,
          model: candidateModel,
          requestUrl,
          tier,
          traceContext,
          requireJson,
          timeoutMs: LLM_REQUEST_TIMEOUT_MS
        });
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'OPENAI_MODEL_NOT_FOUND' || code === 'OPENAI_UNAUTHORIZED') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return undefined;
  };

  return createLlmImplementation({
    cache,
    callByTier,
    effectiveCacheTtlSeconds,
    requestUrl,
    tierModels,
    toolDefinitions,
    toolList,
    toolsDescription,
    toolNamesForParse: TOOL_NAMES_FOR_PARSE
  });
}

export function createOpenAiClientFromEnv(): AgentLlm | undefined {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? process.env.API_KEY_OPENROUTER;
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const apiKey = openRouterApiKey ?? openAiApiKey;
  const usingOpenRouter = Boolean(openRouterApiKey);
  const model = usingOpenRouter
    ? process.env.OPENROUTER_MODEL ?? 'openai/gpt-5-nano'
    : process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const openAiFallbackModel = usingOpenRouter ? 'openai/gpt-4.1-mini' : 'gpt-4.1-mini';
  const fallbackList = model === openAiFallbackModel ? undefined : [openAiFallbackModel];
  const models = { balanced: model, fast: model, premium: model };
  const modelFallbacks = {
    balanced: fallbackList,
    fast: fallbackList,
    premium: fallbackList
  };

  const configuredOpenRouterUrl = process.env.OPENROUTER_URL?.trim();
  const openRouterRequestUrl =
    configuredOpenRouterUrl && isValidAbsoluteHttpUrl(configuredOpenRouterUrl)
      ? configuredOpenRouterUrl
      : OPENROUTER_URL;
  const requestUrl = usingOpenRouter ? openRouterRequestUrl : OPENAI_URL;
  const redisUrl =
    process.env.AGENT_LLM_CACHE_REDIS_URL ?? process.env.AGENT_REDIS_URL ?? process.env.REDIS_URL;
  const cacheEnabled =
    process.env.AGENT_LLM_CACHE_ENABLED === 'false'
      ? false
      : process.env.AGENT_LLM_CACHE_ENABLED === 'true'
        ? true
        : Boolean(redisUrl?.trim());
  const cache = createLlmCacheStoreFromEnv({
    enabled: cacheEnabled,
    redisUrl
  });

  if (!apiKey) {
    return undefined;
  }

  logger.debug('[llm.config]', {
    hasOpenAiApiKey: Boolean(openAiApiKey),
    hasOpenRouterApiKey: Boolean(openRouterApiKey),
    model,
    models,
    modelFallbacks,
    provider: usingOpenRouter ? 'openrouter' : 'openai',
    requestUrl
  });

  return createOpenAiClient({
    apiKey,
    cache,
    cacheTtlSeconds: {
      extractComplianceFacts: parseInt(
        process.env.AGENT_LLM_CACHE_TTL_EXTRACT_COMPLIANCE_FACTS_SEC ?? '300',
        10
      ),
      selectTool: parseInt(process.env.AGENT_LLM_CACHE_TTL_SELECT_TOOL_SEC ?? '120', 10)
    },
    model,
    modelFallbacks,
    models,
    requestUrl
  });
}
