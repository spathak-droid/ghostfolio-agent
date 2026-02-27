import { createHash } from 'crypto';

import {
  AgentLlm,
  ComplianceFacts,
  AgentTraceContext,
  AgentToolName,
  CreateOrderParams
} from '../types';
import {
  formatToolsForLlm,
  getSelectableToolDefinitions,
  SELECTABLE_TOOL_NAMES,
  type ToolDefinition
} from '../tools/tool-registry';
import { logger } from '../utils';
import {
  enforceFinanceScopeAnswer,
  extractMessageContent,
  fallbackDirectAnswer,
  getUtcContext,
  isValidAbsoluteHttpUrl,
  parseFlexibleNumber
} from './openai-client-helpers';
import { callOpenAi } from './openai-client-request';
import {
  parseReasoningDecision,
  parseToolSelection,
  runWithOptionalTrace
} from './openai-client-runtime';
import { createLlmCacheStoreFromEnv, type LlmCacheStore } from './llm-cache';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LLM_REQUEST_TIMEOUT_MS = 25_000;

/** Valid tool names for parsing LLM JSON (from registry). */
const TOOL_NAMES_FOR_PARSE: AgentToolName[] = [...SELECTABLE_TOOL_NAMES];

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

  return {
    async answerFinanceQuestion(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.answer_finance_question] INPUT', {
            message,
            conversationLength: conversation.length
          });
          try {
            const content = await callByTier({
              tier: 'balanced',
              traceContext,
              requireJson: false,
              messages: [
                {
                  content:
                    'You are a finance assistant. Give concise, practical answers for personal investing and portfolio questions.',
                  role: 'system'
                },
                ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
                  content: pastContent,
                  role
                })),
                { content: message, role: 'user' }
              ]
            });
            if (content) {
              logger.debug('[llm.answer_finance_question] OUTPUT', {
                resultLength: content.length,
                resultPreview:
                  content.slice(0, 300) + (content.length > 300 ? '...' : '')
              });
              return enforceFinanceScopeAnswer(message, content);
            }

            const retryContent = await callByTier({
              tier: 'balanced',
              traceContext,
              requireJson: false,
              messages: [
                {
                  content:
                    'Answer the user clearly in one short paragraph. If they ask for a joke, provide one.',
                  role: 'system'
                },
                { content: message, role: 'user' }
              ]
            });
            if (retryContent) {
              logger.debug('[llm.answer_finance_question] OUTPUT (retry)', {
                resultLength: retryContent.length,
                resultPreview:
                  retryContent.slice(0, 300) +
                  (retryContent.length > 300 ? '...' : '')
              });
              return enforceFinanceScopeAnswer(message, retryContent);
            }
            const fallback = enforceFinanceScopeAnswer(message, fallbackDirectAnswer(message));
            logger.debug('[llm.answer_finance_question] OUTPUT (fallback)', {
              resultPreview: fallback.slice(0, 200)
            });
            return fallback;
          } catch (err) {
            const code = (err as Error & { code?: string }).code;
            if (code === 'OPENAI_UNAUTHORIZED') {
              const msg = (err as Error).message;
              return msg ? `OpenAI API (401): ${msg}` : 'OpenAI API returned 401 Unauthorized.';
            }
            if (code === 'OPENAI_MODEL_NOT_FOUND') {
              const msg = (err as Error).message;
              return msg
                ? `OpenAI API (404): ${msg} The model in OPENAI_MODEL may not be available on the Chat Completions endpoint; try gpt-4o-mini or gpt-4o.`
                : 'OpenAI API returned 404 (model not found). Set OPENAI_MODEL to a Chat Completions model, e.g. gpt-4o-mini or gpt-4o.';
            }
            throw err;
          }
        },
        step: 'llm.answer_finance_question',
        traceContext
      });
    },
    async reasonAboutQuery(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.reason_about_query] INPUT', {
            message,
            conversationLength: conversation.length,
            lastMessages: conversation.slice(-3).map((m) => ({ role: m.role, contentPreview: String(m.content).slice(0, 100) }))
          });
          const { todayUtc, nowUtc } = getUtcContext();
          const routingPrompt = `You decide routing for finance user requests. Use UTC for all dates.

Today (UTC date): ${todayUtc}
Now (UTC): ${nowUtc}

Date rule: Treat year/month mentions as historical unless explicitly future. Parse any date the user mentions relative to Today (UTC). If parsed date < today → historical request → direct_reply that current-only market data is available. If parsed date > today → future/out of scope → direct_reply with a short explanation.

When to use tool_call: User asks for data we can fetch (current prices, portfolio, balance, transactions, holdings, performance). When in doubt for current data, prefer tool_call so we try to fetch data.
When to use tool_call for orders: 
- For BUY/SELL trade execution (e.g. "buy me a Tesla stock", "record a sell"), use tool: create_order.
- For non-trade activities (DIVIDEND/FEE/INTEREST/LIABILITY), use tool: create_other_activities.
Use tool_call even if quantity/amount/details are missing; the tool will ask follow-up clarification.
When to use direct_reply: Greetings, definitions ("what is X?"), or clearly out-of-scope future requests only.

If the question implies retrieval of data (price, balance, transactions, performance), set requires_factual_data to true and use mode: tool_call even when unsure.
If the question asks for past/historical data (e.g. "last month", specific year), set needs_history to true and prefer direct_reply with limitation.

Available tools (use exactly these names or none):
${toolsDescription}

Return strict JSON with exactly these fields:
{"intent":"finance|general","mode":"direct_reply|tool_call","tool":"${toolList}|none","rationale":"short reason","requires_factual_data":true|false,"needs_history":true|false,"tools":["tool1","tool2"]}
- Use "tool" for a single primary tool. If the user clearly asks for more than one kind of data (e.g. balance and a price), you may also set "tools" to an array of tool names to call; otherwise omit "tools" or use [].`;
          const content = await callByTier({
            tier: 'fast',
            traceContext,
            requireJson: true,
            messages: [
              {
                content: routingPrompt,
                role: 'system'
              },
              ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
                content: pastContent,
                role
              })),
              { content: message, role: 'user' }
            ]
          });
          const decision = parseReasoningDecision(content, TOOL_NAMES_FOR_PARSE);
          logger.debug('[llm.reason_about_query] OUTPUT', { rawContent: content?.slice(0, 200), decision });
          return decision;
        },
        step: 'llm.reason_about_query',
        traceContext
      });
    },
    async selectTool(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.select_tool] INPUT', { message, conversationLength: conversation.length });
          const conversationWindow = conversation.slice(-6);
          const cacheKey = buildCacheKey({
            message,
            model: tierModels.fast,
            operation: 'select_tool',
            requestUrl,
            toolNames: toolDefinitions.map((d) => d.name),
            window: conversationWindow.map(({ content: c, role }) => ({ content: c, role }))
          });
          const cachedSelection = await getCachedJson<{ tool: AgentToolName | 'none' }>(cache, cacheKey);
          if (cachedSelection) {
            logger.debug('[llm.select_tool] CACHE_HIT', { cacheKey });
            return cachedSelection;
          }
          const { todayUtc, nowUtc } = getUtcContext();
          let content: string | undefined;
          try {
            content = await callByTier({
              tier: 'fast',
              traceContext,
              requireJson: true,
              messages: [
                {
                  content: `Select the best tool for a finance user request.
Today (UTC date): ${todayUtc}
Now (UTC): ${nowUtc}

For current price requests, prefer market_data. For historical/past-date price requests, use none and answer with a short current-only limitation.

Available tools (use exactly one name or none):
${toolsDescription}
Return strict JSON: {"tool":"${toolList}|none"}`,
                  role: 'system'
                },
                ...conversationWindow.map(({ content: pastContent, role }) => ({
                  content: pastContent,
                  role
                })),
                { content: message, role: 'user' }
              ]
            });
          } catch {
            return { tool: 'none' };
          }
          const selection = parseToolSelection(content, TOOL_NAMES_FOR_PARSE);
          await setCachedJson(cache, cacheKey, selection, effectiveCacheTtlSeconds.selectTool);
          logger.debug('[llm.select_tool] OUTPUT', { rawContent: content?.slice(0, 150), tool: selection?.tool });
          return selection;
        },
        step: 'llm.select_tool',
        traceContext
      });
    },
    async getToolParametersForOrder(message, conversation, toolName, traceContext) {
      if (toolName !== 'create_order' && toolName !== 'create_other_activities') return undefined;
      return runWithOptionalTrace({
        fn: async () => {
          const schema =
            'CreateOrderParams: { symbol: string (ticker or name, e.g. AAPL or Apple), type: "BUY"|"SELL"|"DIVIDEND"|"FEE"|"INTEREST"|"LIABILITY", quantity?: number (required for BUY/SELL), unitPrice?: number (for DIVIDEND/FEE/INTEREST/LIABILITY this is the activity amount), date?: string (ISO date), currency?: string (e.g. USD), fee?: number, accountId?: string, dataSource?: string, comment?: string }. Extract from the user message and conversation context (e.g. "10" after "How many shares?" means quantity 10). Use ticker when known (e.g. Apple -> AAPL).';
          const content = await callByTier({
            tier: 'fast',
            traceContext,
            requireJson: true,
            messages: [
              {
                content: `You extract structured parameters for a finance agent tool. Conversation and latest user message are below. Return a single JSON object with only the fields you can infer. Use null for missing optional fields; omit required fields if not mentioned (tool will ask). ${schema} Return strict JSON only, no markdown.`,
                role: 'system'
              },
              ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
                content: pastContent,
                role
              })),
              { content: message, role: 'user' }
            ]
          });
          if (!content) return undefined;
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            const params: Partial<CreateOrderParams> = {};
            if (typeof parsed.symbol === 'string' && parsed.symbol.trim()) {
              params.symbol = parsed.symbol.trim();
            }
            if (typeof parsed.type === 'string' && parsed.type.trim()) {
              params.type = parsed.type as CreateOrderParams['type'];
            }
            const quantity = parseFlexibleNumber(parsed.quantity);
            if (quantity !== undefined) params.quantity = quantity;
            const unitPrice = parseFlexibleNumber(parsed.unitPrice);
            if (unitPrice !== undefined) params.unitPrice = unitPrice;
            if (typeof parsed.date === 'string' && parsed.date.trim()) params.date = parsed.date.trim();
            if (typeof parsed.currency === 'string' && parsed.currency.trim())
              params.currency = parsed.currency.trim();
            const fee = parseFlexibleNumber(parsed.fee);
            if (fee !== undefined) params.fee = fee;
            if (typeof parsed.accountId === 'string' && parsed.accountId.trim())
              params.accountId = parsed.accountId.trim();
            if (typeof parsed.dataSource === 'string' && parsed.dataSource.trim())
              params.dataSource = parsed.dataSource.trim();
            if (typeof parsed.comment === 'string') params.comment = parsed.comment.trim();
            if (Object.keys(params).length === 0) return undefined;
            return params;
          } catch {
            return undefined;
          }
        },
        step: 'llm.get_tool_parameters_for_order',
        traceContext
      });
    },
    async extractComplianceFacts(message, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          const cacheKey = buildCacheKey({
            message,
            model: tierModels.fast,
            operation: 'extract_compliance_facts',
            requestUrl
          });
          const cachedFacts = await getCachedJson<Partial<ComplianceFacts> | undefined>(cache, cacheKey);
          if (cachedFacts) {
            logger.debug('[llm.extract_compliance_facts] CACHE_HIT', { cacheKey });
            return cachedFacts;
          }
          const content = await callByTier({
            tier: 'fast',
            traceContext,
            requireJson: true,
            messages: [
              {
                content:
                  'Extract only compliance signal facts from the user message. Return strict JSON only with these keys: ' +
                  '{"alternative_minimum_tax_topic":boolean,"capital_gains_topic":boolean,"concentration_risk":boolean,"constraints":boolean,' +
                  '"cost_basis_topic":boolean,"etf_tax_efficiency_topic":boolean,"horizon":boolean,"ira_contribution_limits_topic":boolean,"is_recommendation":boolean,' +
                  '"net_investment_income_tax_topic":boolean,' +
                  '"quote_is_fresh":boolean|null,"quote_staleness_check":boolean,"replacement_buy_signal":boolean,' +
                  '"qualified_dividends_topic":boolean,"required_minimum_distributions_topic":boolean,' +
                  '"realized_pnl":"LOSS"|"GAIN"|null,"risk_tolerance":boolean,"tax_loss_harvesting_topic":boolean,"transaction_type":"BUY"|"SELL"|null}. ' +
                  'Do not add extra keys.',
                role: 'system'
              },
              { content: message, role: 'user' }
            ]
          });
          if (!content) {
            return undefined;
          }
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            const facts = parseComplianceFacts(parsed);
            if (facts) {
              await setCachedJson(
                cache,
                cacheKey,
                facts,
                effectiveCacheTtlSeconds.extractComplianceFacts
              );
            }
            return facts;
          } catch {
            return undefined;
          }
        },
        step: 'llm.extract_compliance_facts',
        traceContext
      });
    },
    async synthesizeToolErrors(toolErrors, userMessage, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.synthesize_tool_errors] INPUT', {
            toolErrorCount: toolErrors.length,
            userMessage: userMessage.slice(0, 100),
            toolNames: toolErrors.map((e) => e.toolName)
          });

          try {
            const toolErrorList = toolErrors
              .map((error) => `${error.toolName}: ${error.message}`)
              .join('\n');

            const content = await callByTier({
              tier: 'fast',
              traceContext,
              requireJson: false,
              messages: [
                {
                  content:
                    'You are a finance AI assistant explaining tool failures to users. When given tool error messages, produce one concise sentence per error describing what failed and what the user should do. Trust error messages completely — do not speculate about portfolio state. If an asset is not found in the portfolio, say so clearly. Do not mention internal system details.',
                  role: 'system'
                },
                {
                  content: `The user asked: "${userMessage}"\n\nThese tools failed:\n${toolErrorList}\n\nProvide one concise sentence per error explaining what failed and what to do next.`,
                  role: 'user'
                }
              ]
            });

            if (!content) {
              logger.debug('[llm.synthesize_tool_errors] OUTPUT (empty)', {});
              return '';
            }

            const normalized = extractMessageContent(content);
            logger.debug('[llm.synthesize_tool_errors] OUTPUT', {
              resultLength: normalized.length,
              resultPreview: normalized.slice(0, 200)
            });
            return normalized;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const code = (error as Error & { code?: string }).code;

            logger.warn('[llm.synthesize_tool_errors] API_FAILED', {
              errorCode: code,
              errorMessage: errorMsg,
              toolErrorCount: toolErrors.length
            });

            // Graceful fallback: return formatted tool errors without LLM synthesis
            return toolErrors
              .map((error) => `${error.toolName}: ${error.message}`)
              .join('\n');
          }
        },
        step: 'llm.synthesize_tool_errors',
        traceContext
      });
    }
  };
}

function parseComplianceFacts(input: Record<string, unknown>): Partial<ComplianceFacts> | undefined {
  const result: Partial<ComplianceFacts> = {};
  if (typeof input.alternative_minimum_tax_topic === 'boolean') {
    result.alternative_minimum_tax_topic = input.alternative_minimum_tax_topic;
  }
  if (typeof input.capital_gains_topic === 'boolean') {
    result.capital_gains_topic = input.capital_gains_topic;
  }
  if (typeof input.concentration_risk === 'boolean') {
    result.concentration_risk = input.concentration_risk;
  }
  if (typeof input.constraints === 'boolean') {
    result.constraints = input.constraints;
  }
  if (typeof input.cost_basis_topic === 'boolean') {
    result.cost_basis_topic = input.cost_basis_topic;
  }
  if (typeof input.etf_tax_efficiency_topic === 'boolean') {
    result.etf_tax_efficiency_topic = input.etf_tax_efficiency_topic;
  }
  if (typeof input.horizon === 'boolean') {
    result.horizon = input.horizon;
  }
  if (typeof input.ira_contribution_limits_topic === 'boolean') {
    result.ira_contribution_limits_topic = input.ira_contribution_limits_topic;
  }
  if (typeof input.is_recommendation === 'boolean') {
    result.is_recommendation = input.is_recommendation;
  }
  if (typeof input.net_investment_income_tax_topic === 'boolean') {
    result.net_investment_income_tax_topic = input.net_investment_income_tax_topic;
  }
  if (typeof input.quote_is_fresh === 'boolean') {
    result.quote_is_fresh = input.quote_is_fresh;
  }
  if (typeof input.quote_staleness_check === 'boolean') {
    result.quote_staleness_check = input.quote_staleness_check;
  }
  if (typeof input.qualified_dividends_topic === 'boolean') {
    result.qualified_dividends_topic = input.qualified_dividends_topic;
  }
  if (typeof input.required_minimum_distributions_topic === 'boolean') {
    result.required_minimum_distributions_topic = input.required_minimum_distributions_topic;
  }
  if (typeof input.replacement_buy_signal === 'boolean') {
    result.replacement_buy_signal = input.replacement_buy_signal;
  }
  if (input.realized_pnl === 'LOSS' || input.realized_pnl === 'GAIN') {
    result.realized_pnl = input.realized_pnl;
  }
  if (typeof input.risk_tolerance === 'boolean') {
    result.risk_tolerance = input.risk_tolerance;
  }
  if (typeof input.tax_loss_harvesting_topic === 'boolean') {
    result.tax_loss_harvesting_topic = input.tax_loss_harvesting_topic;
  }
  if (input.transaction_type === 'BUY' || input.transaction_type === 'SELL') {
    result.transaction_type = input.transaction_type;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildCacheKey({
  message,
  model,
  operation,
  requestUrl,
  toolNames,
  window
}: {
  message: string;
  model: string;
  operation: 'extract_compliance_facts' | 'select_tool';
  requestUrl: string;
  toolNames?: string[];
  window?: { content: string; role: 'assistant' | 'user' }[];
}): string {
  const payload = {
    message: normalizeText(message),
    model,
    operation,
    requestUrl,
    toolNames: toolNames?.slice().sort(),
    window: window?.map(({ content, role }) => ({ content: normalizeText(content), role }))
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `llm_cache:${operation}:${digest}`;
}

async function getCachedJson<T>(cache: LlmCacheStore | undefined, key: string): Promise<T | undefined> {
  if (!cache) return undefined;
  try {
    const value = await cache.get(key);
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function setCachedJson(
  cache: LlmCacheStore | undefined,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(key, JSON.stringify(value), ttlSeconds);
  } catch {
    // Ignore cache write errors to keep LLM path fail-open.
  }
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
