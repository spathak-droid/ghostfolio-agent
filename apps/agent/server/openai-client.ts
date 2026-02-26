import { traceable } from 'langsmith/traceable';

import {
  AgentLlm,
  ComplianceFacts,
  AgentTraceContext,
  AgentToolName,
  CreateOrderParams
} from './types';
import {
  formatToolsForLlm,
  getSelectableToolDefinitions,
  SELECTABLE_TOOL_NAMES,
  type ToolDefinition
} from './tools/tool-registry';
import { logger } from './logger';
import {
  enforceGreetingCapabilityAnswer,
  extractMessageContent,
  fallbackDirectAnswer,
  getUtcContext,
  isValidAbsoluteHttpUrl,
  normalizeStructuredMarkdown,
  parseFlexibleNumber
} from './openai-client-helpers';
import {
  parseReasoningDecision,
  parseToolSelection,
  runWithOptionalTrace
} from './openai-client-runtime';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LLM_REQUEST_TIMEOUT_MS = 25_000;

interface OpenAiChatResponse {
  choices?: {
    message?: {
      content?: unknown;
    };
  }[];
}

/** Valid tool names for parsing LLM JSON (from registry). */
const TOOL_NAMES_FOR_PARSE: AgentToolName[] = [...SELECTABLE_TOOL_NAMES];

export function createOpenAiClient({
  apiKey,
  model,
  modelFallbacks = {},
  models,
  requestUrl = OPENAI_URL,
  toolDefinitions = getSelectableToolDefinitions()
}: {
  apiKey: string;
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
          requireJson
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
              const normalizedContent = enforceGreetingCapabilityAnswer(message, content);
              logger.debug('[llm.answer_finance_question] OUTPUT', {
                resultLength: normalizedContent.length,
                resultPreview:
                  normalizedContent.slice(0, 300) + (normalizedContent.length > 300 ? '...' : '')
              });
              return normalizedContent;
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
              const normalizedRetryContent = enforceGreetingCapabilityAnswer(message, retryContent);
              logger.debug('[llm.answer_finance_question] OUTPUT (retry)', {
                resultLength: normalizedRetryContent.length,
                resultPreview:
                  normalizedRetryContent.slice(0, 300) +
                  (normalizedRetryContent.length > 300 ? '...' : '')
              });
              return normalizedRetryContent;
            }
            const fallback = fallbackDirectAnswer(message);
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
                ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
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
          logger.debug('[llm.select_tool] OUTPUT', { rawContent: content?.slice(0, 150), tool: selection?.tool });
          return selection;
        },
        step: 'llm.select_tool',
        traceContext
      });
    },
    async synthesizeFromToolResults(message, conversation, toolSummary, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.synthesize_from_tool_results] INPUT', {
            message,
            toolSummaryLength: toolSummary.length,
            toolSummaryPreview: toolSummary.slice(0, 600) + (toolSummary.length > 600 ? '...' : '')
          });
          const todayIso = new Date().toISOString().slice(0, 10);
          const systemPrompt =
            'You are a finance assistant. The user asked a question and we ran tools. Below is the structured output from those tools. ' +
            'Turn it into a concise, natural reply that answers the user. Do not invent data. ' +
            'Output format requirements (always follow): ' +
            'Return plain text only (no markdown syntax). ' +
            'Use section labels with ":" and line breaks. ' +
            'Use "-" bullets for facts and metrics. ' +
            'Use numbered items only for actionable next steps when there are at least two concrete steps. ' +
            'Do not return one dense paragraph. ' +
            'Use this section order when relevant: "Summary:", "Key Metrics:", "Breakdown:", "Risks & Gaps:", "Next Steps:". ' +
            'Keep each bullet short and data-first (metric then value). Keep formatting clean with one blank line between sections. ' +
            'Avoid heavy styling and avoid repeating the same number in multiple sections unless necessary. ' +
            'For ordinary factual queries, keep to 2-5 bullets total and at most one short next-step bullet unless the user explicitly asks for a detailed plan. ' +
            'Portfolio vs cash (critical): USD is cash, not a holding. When the tool output mentions holdings, allocation, or portfolio: report investments (holdings) only separately from Cash (USD). Do not describe "portfolio" as including cash in the same phrase. Use wording like: "Your holdings are worth X. Cash (USD): Y. Total value: Z." Never say "your portfolio has X in cash" or "portfolio has total value X with Y in cash"; instead say "Holdings: X. Cash (USD): Y. Total value: Z." ' +
            'Add "Not financial advice." at the end only when your response could be construed as personalized investment advice or when you are uncertain; do not add it for simple factual answers (e.g. listing balances, transactions, or reporting data). ' +
            'Respect the user\'s question: only include data that matches what they asked. ' +
            'Time periods: Today\'s date is ' +
            todayIso +
            '. "Last year" means the previous calendar year (e.g. if today is 2026, last year = 2025). "This year" means the current calendar year. ' +
            'If the user asked about a specific time period, include only transactions or facts whose date falls in that period; omit anything outside it. ' +
            'When a "Transaction list" is provided, use only the rows whose date matches the user\'s requested period; ignore rows outside that period. ' +
            'If they asked about a symbol or type (e.g. only buys), restrict your answer to that. Do not list or imply data that does not match the user\'s intent.';
          const content = await callByTier({
            tier: 'balanced',
            traceContext,
            requireJson: false,
            messages: [
              {
                content: systemPrompt,
                role: 'system'
              },
              ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
                content: pastContent,
                role
              })),
              { content: message, role: 'user' },
              {
                content: `Tool output to summarize:\n${toolSummary}`,
                role: 'user'
              }
            ]
          });
          const result = normalizeStructuredMarkdown(content ?? '');
          logger.debug('[llm.synthesize_from_tool_results] OUTPUT', {
            resultLength: result.length,
            resultPreview: result.slice(0, 400) + (result.length > 400 ? '...' : '')
          });
          return result;
        },
        step: 'llm.synthesize_from_tool_results',
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
          const content = await callByTier({
            tier: 'fast',
            traceContext,
            requireJson: true,
            messages: [
              {
                content:
                  'Extract only compliance signal facts from the user message. Return strict JSON only with these keys: ' +
                  '{"concentration_risk":boolean,"constraints":boolean,"horizon":boolean,"is_recommendation":boolean,' +
                  '"quote_is_fresh":boolean|null,"quote_staleness_check":boolean,"replacement_buy_signal":boolean,' +
                  '"realized_pnl":"LOSS"|"GAIN"|null,"risk_tolerance":boolean,"transaction_type":"BUY"|"SELL"|null}. ' +
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
            return parseComplianceFacts(parsed);
          } catch {
            return undefined;
          }
        },
        step: 'llm.extract_compliance_facts',
        traceContext
      });
    }
  };
}

function parseComplianceFacts(input: Record<string, unknown>): Partial<ComplianceFacts> | undefined {
  const result: Partial<ComplianceFacts> = {};
  if (typeof input.concentration_risk === 'boolean') {
    result.concentration_risk = input.concentration_risk;
  }
  if (typeof input.constraints === 'boolean') {
    result.constraints = input.constraints;
  }
  if (typeof input.horizon === 'boolean') {
    result.horizon = input.horizon;
  }
  if (typeof input.is_recommendation === 'boolean') {
    result.is_recommendation = input.is_recommendation;
  }
  if (typeof input.quote_is_fresh === 'boolean') {
    result.quote_is_fresh = input.quote_is_fresh;
  }
  if (typeof input.quote_staleness_check === 'boolean') {
    result.quote_staleness_check = input.quote_staleness_check;
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
  if (input.transaction_type === 'BUY' || input.transaction_type === 'SELL') {
    result.transaction_type = input.transaction_type;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

async function callOpenAi({
  apiKey,
  candidateIndex,
  messages,
  model,
  requestUrl,
  tier,
  traceContext,
  requireJson
}: {
  apiKey: string;
  candidateIndex: number;
  messages: { role: 'assistant' | 'system' | 'user'; content: string }[];
  model: string;
  requestUrl: string;
  tier: 'balanced' | 'fast' | 'premium';
  traceContext?: AgentTraceContext;
  requireJson: boolean;
}) {
  const provider = requestUrl.includes('openrouter.ai') ? 'openrouter' : 'openai';
  const payload: Record<string, unknown> = {
    messages,
    model
  };

  if (requireJson) {
    payload.response_format = { type: 'json_object' };
  }

  const executeRequest = () =>
    withFetchTimeout((signal) =>
      fetch(requestUrl, {
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        method: 'POST',
        signal
      }),
      LLM_REQUEST_TIMEOUT_MS
    );
  const response =
    traceContext === undefined
      ? await executeRequest()
      : await traceable(executeRequest, {
          metadata: {
            candidate_index: candidateIndex,
            conversation_id: traceContext.conversationId,
            is_fallback: candidateIndex > 0,
            llm_model: model,
            llm_provider: provider,
            llm_tier: tier,
            message_preview: traceContext.messagePreview,
            request_url: requestUrl,
            session_id: traceContext.sessionId,
            step: 'llm.api_call',
            turn_id: traceContext.turnId
          },
          name: `llm.api_call.${provider}.${tier}`,
          run_type: 'llm',
          tags: [
            'agent',
            `conversation:${traceContext.conversationId}`,
            `session:${traceContext.sessionId}`,
            `tier:${tier}`,
            `provider:${provider}`,
            `model:${model}`,
            `turn:${traceContext.turnId}`
          ]
        })();

  logger.debug('[llm.api_call]', {
    candidateIndex,
    isFallback: candidateIndex > 0,
    model,
    provider,
    requestUrl,
    tier
  });

  if (!response.ok) {
    let apiMessage: string;
    try {
      const raw = await response.text();
      try {
        const body = JSON.parse(raw) as { error?: { message?: string }; message?: string };
        apiMessage = (body?.error?.message ?? body?.message ?? raw) || `HTTP ${response.status}`;
      } catch {
        apiMessage = raw || `HTTP ${response.status}`;
      }
    } catch {
      apiMessage = `HTTP ${response.status}`;
    }
    if (response.status === 401) {
      const err = new Error(apiMessage) as Error & { code: string };
      err.code = 'OPENAI_UNAUTHORIZED';
      if (provider === 'openrouter') {
        logger.error('[llm.openrouter.error]', {
          apiMessage,
          candidateIndex,
          code: err.code,
          model,
          provider,
          requestUrl,
          status: response.status,
          tier
        });
      }
      throw err;
    }
    if (response.status === 404) {
      const err = new Error(apiMessage) as Error & { code: string };
      err.code = 'OPENAI_MODEL_NOT_FOUND';
      if (provider === 'openrouter') {
        logger.error('[llm.openrouter.error]', {
          apiMessage,
          candidateIndex,
          code: err.code,
          model,
          provider,
          requestUrl,
          status: response.status,
          tier
        });
      }
      throw err;
    }
    if (provider === 'openrouter') {
      logger.error('[llm.openrouter.error]', {
        apiMessage,
        candidateIndex,
        code: 'OPENROUTER_HTTP_ERROR',
        model,
        provider,
        requestUrl,
        status: response.status,
        tier
      });
    }
    return undefined;
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const extracted = extractMessageContent(data.choices?.[0]?.message?.content);
  return extracted;
}

async function withFetchTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`LLM request timed out after ${timeoutMs}ms`) as Error & {
        code: string;
      };
      timeoutError.code = 'OPENAI_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
    model,
    modelFallbacks,
    models,
    requestUrl
  });
}
