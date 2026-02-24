import { traceable } from 'langsmith/traceable';

import {
  AgentLlm,
  AgentReasoningDecision,
  AgentTraceContext,
  AgentToolName,
  CreateOrderParams,
  UpdateOrderParams
} from './types';
import {
  formatToolsForLlm,
  getSelectableToolDefinitions,
  SELECTABLE_TOOL_NAMES,
  type ToolDefinition
} from './tools/tool-registry';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** UTC date and timestamp for prompts; avoids timezone bugs. */
function getUtcContext(): { todayUtc: string; nowUtc: string } {
  const nowUtc = new Date().toISOString();
  return { todayUtc: nowUtc.slice(0, 10), nowUtc };
}

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
  toolDefinitions = getSelectableToolDefinitions()
}: {
  apiKey: string;
  model: string;
  toolDefinitions?: readonly ToolDefinition[];
}): AgentLlm {
  const toolsDescription = formatToolsForLlm(toolDefinitions);
  const toolList = toolDefinitions.map((d) => d.name).join('|');

  return {
    async answerFinanceQuestion(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          console.log('[llm.answer_finance_question] INPUT', {
            message,
            conversationLength: conversation.length
          });
          try {
            const content = await callOpenAi({
              apiKey,
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
              ],
              model
            });
            // #region agent log
            fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
              body: JSON.stringify({
                sessionId: '2ea507',
                location: 'openai-client.ts:after-first-call',
                message: 'answerFinanceQuestion first LLM call result',
                data: { hasContent: Boolean(content), contentLength: content?.length ?? 0 },
                timestamp: Date.now(),
                hypothesisId: 'B'
              })
            }).catch(() => undefined);
            // #endregion
            if (content) {
              console.log('[llm.answer_finance_question] OUTPUT', {
                resultLength: content.length,
                resultPreview: content.slice(0, 300) + (content.length > 300 ? '...' : '')
              });
              return content;
            }

            const retryContent = await callOpenAi({
              apiKey,
              requireJson: false,
              messages: [
                {
                  content:
                    'Answer the user clearly in one short paragraph. If they ask for a joke, provide one.',
                  role: 'system'
                },
                { content: message, role: 'user' }
              ],
              model
            });
            // #region agent log
            fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
              body: JSON.stringify({
                sessionId: '2ea507',
                location: 'openai-client.ts:after-retry',
                message: 'answerFinanceQuestion retry LLM call result',
                data: { hasRetryContent: Boolean(retryContent), retryLength: retryContent?.length ?? 0 },
                timestamp: Date.now(),
                hypothesisId: 'C'
              })
            }).catch(() => undefined);
            // #endregion
            if (retryContent) {
              console.log('[llm.answer_finance_question] OUTPUT (retry)', {
                resultLength: retryContent.length,
                resultPreview: retryContent.slice(0, 300) + (retryContent.length > 300 ? '...' : '')
              });
              return retryContent;
            }
            // #region agent log
            fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
              body: JSON.stringify({
                sessionId: '2ea507',
                location: 'openai-client.ts:using-fallback',
                message: 'returning fallbackDirectAnswer (both LLM calls returned empty)',
                data: { messagePreview: message.slice(0, 80) },
                timestamp: Date.now(),
                hypothesisId: 'D'
              })
            }).catch(() => undefined);
            // #endregion
            const fallback = fallbackDirectAnswer(message);
            console.log('[llm.answer_finance_question] OUTPUT (fallback)', {
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
          console.log('[llm.reason_about_query] INPUT', {
            message,
            conversationLength: conversation.length,
            lastMessages: conversation.slice(-3).map((m) => ({ role: m.role, contentPreview: String(m.content).slice(0, 100) }))
          });
          const { todayUtc, nowUtc } = getUtcContext();
          const routingPrompt = `You decide routing for finance user requests. Use UTC for all dates.

Today (UTC date): ${todayUtc}
Now (UTC): ${nowUtc}

Date rule: Treat year/month mentions as historical unless explicitly future. Parse any date the user mentions relative to Today (UTC). If parsed date < today → historical → use mode: tool_call (e.g. market_data for price). If parsed date > today → future/out of scope → direct_reply with a short explanation. "Last month" = 1 month lookback from today (UTC); anchor = nearest available daily close.

When to use tool_call: User asks for data we can fetch (prices current or historical, portfolio, balance, transactions, holdings, performance). For any past date use tool_call. When in doubt, prefer tool_call so we try to fetch data.
When to use tool_call for orders: User says they want to buy, sell, add an activity, or record a trade (e.g. "buy me a Tesla stock", "I want to buy Apple", "record a sell") — use mode: tool_call and tool: create_order even if quantity or other details are missing; the create_order tool will ask for them.
When to use direct_reply: Greetings, definitions ("what is X?"), or clearly out-of-scope future requests only.

If the question implies retrieval of data (price, balance, transactions, performance), set requires_factual_data to true and use mode: tool_call even when unsure.
If the question asks for past/historical data (e.g. "last month", specific year), set needs_history to true.

Available tools (use exactly these names or none):
${toolsDescription}

Return strict JSON with exactly these fields:
{"intent":"finance|general","mode":"direct_reply|tool_call","tool":"${toolList}|none","rationale":"short reason","requires_factual_data":true|false,"needs_history":true|false,"tools":["tool1","tool2"]}
- Use "tool" for a single primary tool. If the user clearly asks for more than one kind of data (e.g. balance and a price), you may also set "tools" to an array of tool names to call; otherwise omit "tools" or use [].`;
          const content = await callOpenAi({
            apiKey,
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
            ],
            model
          });
          const decision = parseReasoningDecision(content);
          console.log('[llm.reason_about_query] OUTPUT', { rawContent: content?.slice(0, 200), decision });
          return decision;
        },
        step: 'llm.reason_about_query',
        traceContext
      });
    },
    async selectTool(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          console.log('[llm.select_tool] INPUT', { message, conversationLength: conversation.length });
          const { todayUtc, nowUtc } = getUtcContext();
          const content = await callOpenAi({
            apiKey,
            requireJson: true,
            messages: [
              {
                content: `Select the best tool for a finance user request.
Today (UTC date): ${todayUtc}
Now (UTC): ${nowUtc}

For price requests (current or historical, e.g. "how much was X in 2025"), prefer market_data. Use none only when no tool fits.

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
            ],
            model
          });
          const selection = parseToolSelection(content);
          console.log('[llm.select_tool] OUTPUT', { rawContent: content?.slice(0, 150), tool: selection?.tool });
          return selection;
        },
        step: 'llm.select_tool',
        traceContext
      });
    },
    async synthesizeFromToolResults(message, conversation, toolSummary, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          console.log('[llm.synthesize_from_tool_results] INPUT', {
            message,
            toolSummaryLength: toolSummary.length,
            toolSummaryPreview: toolSummary.slice(0, 600) + (toolSummary.length > 600 ? '...' : '')
          });
          const todayIso = new Date().toISOString().slice(0, 10);
          const systemPrompt =
            'You are a finance assistant. The user asked a question and we ran tools. Below is the structured output from those tools. ' +
            'Turn it into a concise, natural reply that answers the user. Do not invent data. ' +
            'Portfolio vs cash (critical): USD is cash, not a holding. When the tool output mentions holdings, allocation, or portfolio: report investments (holdings) only separately from Cash (USD). Do not describe "portfolio" as including cash in the same phrase. Use wording like: "Your holdings are worth X. Cash (USD): Y. Total value: Z." Never say "your portfolio has X in cash" or "portfolio has total value X with Y in cash"; instead say "Holdings: X. Cash (USD): Y. Total value: Z." ' +
            'Add "Not financial advice." at the end only when your response could be construed as personalized investment advice or when you are uncertain; do not add it for simple factual answers (e.g. listing balances, transactions, or reporting data). ' +
            'Respect the user\'s question: only include data that matches what they asked. ' +
            'Time periods: Today\'s date is ' +
            todayIso +
            '. "Last year" means the previous calendar year (e.g. if today is 2026, last year = 2025). "This year" means the current calendar year. ' +
            'If the user asked about a specific time period, include only transactions or facts whose date falls in that period; omit anything outside it. ' +
            'When a "Transaction list" is provided, use only the rows whose date matches the user\'s requested period; ignore rows outside that period. ' +
            'If they asked about a symbol or type (e.g. only buys), restrict your answer to that. Do not list or imply data that does not match the user\'s intent.';
          const content = await callOpenAi({
            apiKey,
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
            ],
            model
          });
          const result = content ?? '';
          console.log('[llm.synthesize_from_tool_results] OUTPUT', {
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
      return runWithOptionalTrace({
        fn: async () => {
          const schema =
            toolName === 'create_order'
              ? 'CreateOrderParams: { symbol: string (ticker or name, e.g. AAPL or Apple), type: "BUY"|"SELL"|"DIVIDEND"|"FEE"|"INTEREST"|"LIABILITY", quantity?: number (required for BUY/SELL), unitPrice?: number, date?: string (ISO date), currency?: string (e.g. USD), fee?: number, accountId?: string, dataSource?: string, comment?: string }. Extract from the user message and conversation context (e.g. "10" after "How many shares?" means quantity 10). Use ticker when known (e.g. Apple -> AAPL).'
              : 'UpdateOrderParams: { orderId: string (required; the activity/order id to update), date?: string (ISO), quantity?: number, unitPrice?: number, fee?: number, currency?: string, symbol?: string, type?: string, dataSource?: string, accountId?: string, comment?: string, tags?: string[] }. Extract from the user message and conversation.';
          const content = await callOpenAi({
            apiKey,
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
            ],
            model
          });
          if (!content) return undefined;
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            if (toolName === 'create_order') {
              const symbol = typeof parsed.symbol === 'string' ? parsed.symbol.trim() : undefined;
              const type = typeof parsed.type === 'string' ? (parsed.type as CreateOrderParams['type']) : undefined;
              if (!symbol || !type) return undefined;
              const params: CreateOrderParams = { symbol, type };
              if (typeof parsed.quantity === 'number' && Number.isFinite(parsed.quantity))
                params.quantity = parsed.quantity;
              if (typeof parsed.unitPrice === 'number' && Number.isFinite(parsed.unitPrice))
                params.unitPrice = parsed.unitPrice;
              if (typeof parsed.date === 'string' && parsed.date.trim()) params.date = parsed.date.trim();
              if (typeof parsed.currency === 'string' && parsed.currency.trim())
                params.currency = parsed.currency.trim();
              if (typeof parsed.fee === 'number' && Number.isFinite(parsed.fee)) params.fee = parsed.fee;
              if (typeof parsed.accountId === 'string' && parsed.accountId.trim())
                params.accountId = parsed.accountId.trim();
              if (typeof parsed.dataSource === 'string' && parsed.dataSource.trim())
                params.dataSource = parsed.dataSource.trim();
              if (typeof parsed.comment === 'string') params.comment = parsed.comment.trim();
              return params;
            }
            const orderId = typeof parsed.orderId === 'string' ? parsed.orderId.trim() : undefined;
            if (!orderId) return undefined;
            const params: UpdateOrderParams = { orderId };
            if (typeof parsed.date === 'string' && parsed.date.trim()) params.date = parsed.date.trim();
            if (typeof parsed.quantity === 'number' && Number.isFinite(parsed.quantity))
              params.quantity = parsed.quantity;
            if (typeof parsed.unitPrice === 'number' && Number.isFinite(parsed.unitPrice))
              params.unitPrice = parsed.unitPrice;
            if (typeof parsed.fee === 'number' && Number.isFinite(parsed.fee)) params.fee = parsed.fee;
            if (typeof parsed.currency === 'string' && parsed.currency.trim())
              params.currency = parsed.currency.trim();
            if (typeof parsed.symbol === 'string' && parsed.symbol.trim()) params.symbol = parsed.symbol.trim();
            if (typeof parsed.type === 'string' && parsed.type.trim()) params.type = parsed.type.trim();
            if (typeof parsed.dataSource === 'string' && parsed.dataSource.trim())
              params.dataSource = parsed.dataSource.trim();
            if (typeof parsed.accountId === 'string' && parsed.accountId.trim())
              params.accountId = parsed.accountId.trim();
            if (typeof parsed.comment === 'string') params.comment = parsed.comment.trim();
            if (Array.isArray(parsed.tags)) params.tags = (parsed.tags as string[]).filter((t) => typeof t === 'string');
            return params;
          } catch {
            return undefined;
          }
        },
        step: 'llm.get_tool_parameters_for_order',
        traceContext
      });
    }
  };
}

function fallbackDirectAnswer(message: string) {
  const normalized = message.trim().toLowerCase();
  if (['hello', 'hi', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening'].includes(normalized)) {
    return 'Hi. I can help with portfolio, transactions, and market-data questions.';
  }

  if (normalized.includes('finance joke') || normalized.includes('financial joke')) {
    return 'Finance joke: I tried to beat the market, but my fees beat me first.';
  }

  if (normalized.includes('joke')) {
    return 'Joke: My portfolio and I have a lot in common, both are down for the long term.';
  }

  return 'I can help with portfolio, market data, and transaction questions. Ask me about holdings, allocation, buy dates, or entry prices.';
}

function buildRuntimeTraceConfig({
  step,
  traceContext
}: {
  step: string;
  traceContext?: AgentTraceContext;
}) {
  if (!traceContext) {
    return undefined;
  }

  return {
    metadata: {
      conversation_id: traceContext.conversationId,
      message_preview: traceContext.messagePreview,
      session_id: traceContext.sessionId,
      step,
      turn_id: traceContext.turnId
    },
    tags: [
      'agent',
      `conversation:${traceContext.conversationId}`,
      `session:${traceContext.sessionId}`,
      `step:${step}`,
      `turn:${traceContext.turnId}`
    ]
  };
}

async function runWithOptionalTrace<T>({
  fn,
  step,
  traceContext
}: {
  fn: () => Promise<T>;
  step: string;
  traceContext?: AgentTraceContext;
}) {
  const traceConfig = buildRuntimeTraceConfig({ step, traceContext });
  if (!traceConfig || !traceContext) {
    return fn();
  }

  return traceable(
    async () => fn(),
    {
      metadata: traceConfig.metadata,
      name: `${step}.turn_${traceContext.turnId}`,
      run_type: 'chain',
      tags: traceConfig.tags
    }
  )();
}

function parseToolSelection(content?: string): { tool: AgentToolName | 'none' } {
  if (!content) {
    return { tool: 'none' };
  }

  try {
    const parsed = JSON.parse(content) as { tool?: AgentToolName | 'none' };

    if (parsed.tool && [...TOOL_NAMES_FOR_PARSE, 'none'].includes(parsed.tool)) {
      return { tool: parsed.tool };
    }
  } catch {
    return { tool: 'none' };
  }

  return { tool: 'none' };
}

function parseReasoningDecision(content?: string): AgentReasoningDecision {
  const defaultDecision: AgentReasoningDecision = {
    intent: 'general',
    mode: 'direct_reply',
    tool: 'none'
  };
  if (!content) {
    return defaultDecision;
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const intent = parsed.intent === 'finance' ? 'finance' : 'general';
    const mode = parsed.mode === 'tool_call' ? 'tool_call' : 'direct_reply';
    const tool =
      typeof parsed.tool === 'string' && [...TOOL_NAMES_FOR_PARSE, 'none'].includes(parsed.tool as AgentToolName)
        ? (parsed.tool as AgentToolName | 'none')
        : 'none';

    let tools: AgentToolName[] | undefined;
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      tools = (parsed.tools as string[]).filter(
        (t): t is AgentToolName =>
          typeof t === 'string' && TOOL_NAMES_FOR_PARSE.includes(t as AgentToolName)
      );
      if (tools.length === 0) tools = undefined;
    }

    return {
      intent,
      mode,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
      tool,
      tools,
      requires_factual_data: typeof parsed.requires_factual_data === 'boolean' ? parsed.requires_factual_data : undefined,
      needs_history: typeof parsed.needs_history === 'boolean' ? parsed.needs_history : undefined
    };
  } catch {
    return defaultDecision;
  }
}

async function callOpenAi({
  apiKey,
  messages,
  model,
  requireJson
}: {
  apiKey: string;
  messages: { role: 'assistant' | 'system' | 'user'; content: string }[];
  model: string;
  requireJson: boolean;
}) {
  const payload: Record<string, unknown> = {
    messages,
    model
  };

  if (requireJson) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch(OPENAI_URL, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  // #region agent log
  const logPayload = {
    sessionId: '2ea507',
    location: 'openai-client.ts:callOpenAi',
    message: 'OpenAI API response',
    data: {
      ok: response.ok,
      status: response.status,
      hasApiKey: Boolean(apiKey)
    },
    timestamp: Date.now(),
    hypothesisId: 'E'
  };
  fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
    body: JSON.stringify(logPayload)
  }).catch(() => undefined);
  // #endregion

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
      throw err;
    }
    if (response.status === 404) {
      const err = new Error(apiMessage) as Error & { code: string };
      err.code = 'OPENAI_MODEL_NOT_FOUND';
      throw err;
    }
    return undefined;
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const extracted = extractMessageContent(data.choices?.[0]?.message?.content);
  // #region agent log
  fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
    body: JSON.stringify({
      sessionId: '2ea507',
      location: 'openai-client.ts:callOpenAi-extracted',
      message: 'extractMessageContent result',
      data: { hasExtracted: Boolean(extracted), extractedLength: extracted?.length ?? 0 },
      timestamp: Date.now(),
      hypothesisId: 'F'
    })
  }).catch(() => undefined);
  // #endregion
  return extracted;
}

function extractMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          const textValue = (item as Record<string, unknown>).text;
          return typeof textValue === 'string' ? textValue : '';
        }

        return '';
      })
      .join('')
      .trim();

    return joined.length > 0 ? joined : undefined;
  }

  if (content && typeof content === 'object') {
    const textValue = (content as Record<string, unknown>).text;
    if (typeof textValue === 'string') {
      const trimmed = textValue.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }

  return undefined;
}

export function createOpenAiClientFromEnv(): AgentLlm | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  if (!apiKey) {
    return undefined;
  }

  return createOpenAiClient({ apiKey, model });
}
