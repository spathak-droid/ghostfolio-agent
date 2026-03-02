/**
 * Purpose: LLM method implementations for createOpenAiClient.
 * Separated to keep openai-client.ts under 700 lines.
 */

import type {
  AgentLlm,
  AgentTraceContext,
  AgentToolName,
  CreateOrderParams
} from '../types';
import type { ComplianceFacts } from '../types';
import type { ToolDefinition } from '../tools/tool-registry';
import type { LlmCacheStore } from './llm-cache';
import { logger } from '../utils';
import {
  enforceFinanceScopeAnswer,
  extractMessageContent,
  fallbackDirectAnswer,
  getUtcContext,
  parseFlexibleNumber
} from './openai-client-helpers';
import { parseReasoningDecision, parseToolSelection, runWithOptionalTrace } from './openai-client-runtime';
import {
  buildCacheKey,
  getCachedJson,
  parseComplianceFacts,
  setCachedJson
} from './openai-client-cache';

export interface OpenAiClientImplDeps {
  cache: LlmCacheStore | undefined;
  callByTier: (opts: {
    messages: { role: 'assistant' | 'system' | 'user'; content: string }[];
    requireJson: boolean;
    tier: 'balanced' | 'fast' | 'premium';
    traceContext?: AgentTraceContext;
  }) => Promise<string | undefined>;
  effectiveCacheTtlSeconds: { extractComplianceFacts: number; selectTool: number };
  requestUrl: string;
  tierModels: Record<'balanced' | 'fast' | 'premium', string>;
  toolDefinitions: readonly ToolDefinition[];
  toolList: string;
  toolsDescription: string;
  toolNamesForParse: AgentToolName[];
}

export function createLlmImplementation(deps: OpenAiClientImplDeps): AgentLlm {
  const {
    cache,
    callByTier,
    effectiveCacheTtlSeconds,
    requestUrl,
    tierModels,
    toolDefinitions,
    toolList,
    toolsDescription,
    toolNamesForParse
  } = deps;

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
                resultPreview: content.slice(0, 300) + (content.length > 300 ? '...' : '')
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
                  retryContent.slice(0, 300) + (retryContent.length > 300 ? '...' : '')
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
            lastMessages: conversation
              .slice(-3)
              .map((m) => ({ role: m.role, contentPreview: String(m.content).slice(0, 100) }))
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
              { content: routingPrompt, role: 'system' },
              ...conversation.slice(-6).map(({ content: pastContent, role }) => ({
                content: pastContent,
                role
              })),
              { content: message, role: 'user' }
            ]
          });
          const decision = parseReasoningDecision(content, toolNamesForParse);
          logger.debug('[llm.reason_about_query] OUTPUT', {
            rawContent: content?.slice(0, 200),
            decision
          });
          return decision;
        },
        step: 'llm.reason_about_query',
        traceContext
      });
    },
    async selectTool(message, conversation, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.select_tool] INPUT', {
            message,
            conversationLength: conversation.length
          });
          const conversationWindow = conversation.slice(-6);
          const cacheKey = buildCacheKey({
            message,
            model: tierModels.fast,
            operation: 'select_tool',
            requestUrl,
            toolNames: toolDefinitions.map((d) => d.name),
            window: conversationWindow.map(({ content: c, role }) => ({ content: c, role }))
          });
          const cachedSelection = await getCachedJson<{ tool: AgentToolName | 'none' }>(
            cache,
            cacheKey
          );
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
          const selection = parseToolSelection(content, toolNamesForParse);
          await setCachedJson(cache, cacheKey, selection, effectiveCacheTtlSeconds.selectTool);
          logger.debug('[llm.select_tool] OUTPUT', {
            rawContent: content?.slice(0, 150),
            tool: selection?.tool
          });
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
            if (typeof parsed.date === 'string' && parsed.date.trim())
              params.date = parsed.date.trim();
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
          const cachedFacts = await getCachedJson<Partial<ComplianceFacts> | undefined>(
            cache,
            cacheKey
          );
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
          if (!content) return undefined;
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
            return toolErrors
              .map((error) => `${error.toolName}: ${error.message}`)
              .join('\n');
          }
        },
        step: 'llm.synthesize_tool_errors',
        traceContext
      });
    },
    async clarifyQuantityUnit(message, symbol, quantity, unitPrice, traceContext) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.clarify_quantity_unit] INPUT', {
            symbol,
            quantity,
            unitPrice,
            messagePreview: message.slice(0, 100)
          });
          try {
            const estimatedCost = quantity * unitPrice;
            const content = await callByTier({
              tier: 'fast',
              traceContext,
              requireJson: true,
              messages: [
                {
                  content:
                    'You are a finance assistant helping clarify ambiguous quantity inputs. ' +
                    'When a user says "100 coins", "100 of X", or similar, determine if they meant: ' +
                    '1. 100 COINS/UNITS of the asset, OR ' +
                    '2. $100 (currency amount) worth of the asset. ' +
                    'Return strict JSON: {"unit":"coins"|"currency","clarification":"brief explanation"}. ' +
                    'If the quantity as-stated would result in a very large transaction (>$100,000), ' +
                    'strongly assume they meant the currency amount instead. Be concise in clarification.',
                  role: 'system'
                },
                {
                  content:
                    `User message: "${message}"\n\n` +
                    `Symbol: ${symbol}\n` +
                    `Stated quantity: ${quantity}\n` +
                    `Current unit price: $${unitPrice.toFixed(2)}\n` +
                    `Estimated cost at stated quantity: $${estimatedCost.toFixed(2)}\n\n` +
                    `Determine if the quantity "${quantity}" should be interpreted as ${quantity} COINS of ${symbol}, ` +
                    `or $${quantity} worth of ${symbol}.`,
                  role: 'user'
                }
              ]
            });
            if (!content) {
              logger.debug('[llm.clarify_quantity_unit] OUTPUT (empty)', {});
              return undefined;
            }
            try {
              const parsed = JSON.parse(content) as Record<string, unknown>;
              const unit =
                parsed.unit === 'coins' || parsed.unit === 'currency' ? parsed.unit : undefined;
              const clarification =
                typeof parsed.clarification === 'string' ? parsed.clarification.trim() : '';
              if (!unit) {
                logger.warn('[llm.clarify_quantity_unit] Invalid unit in response', { parsed });
                return undefined;
              }
              logger.debug('[llm.clarify_quantity_unit] OUTPUT', {
                unit,
                clarificationLength: clarification.length
              });
              return { unit, clarification };
            } catch (parseError) {
              logger.warn('[llm.clarify_quantity_unit] JSON parse failed', {
                contentPreview: content.slice(0, 100),
                error: parseError instanceof Error ? parseError.message : String(parseError)
              });
              return undefined;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const code = (error as Error & { code?: string }).code;
            logger.warn('[llm.clarify_quantity_unit] API_FAILED', {
              errorCode: code,
              errorMessage: errorMsg
            });
            return undefined;
          }
        },
        step: 'llm.clarify_quantity_unit',
        traceContext
      });
    },
    async generateToolParameters(message, selectedTools, conversation, traceContext?) {
      return runWithOptionalTrace({
        fn: async () => {
          logger.debug('[llm.generate_tool_parameters] INPUT', {
            message: message.slice(0, 100),
            selectedTools,
            conversationLength: conversation.length
          });
          try {
            const content = await callByTier({
              tier: 'fast',
              traceContext,
              requireJson: true,
              messages: [
                {
                  content: `You are a search-query extractor for asset/security lookups. Extract the exact words or phrases the user used to refer to assets—do NOT convert to ticker symbols. A downstream symbol lookup API will resolve these queries.

RULES:
1. Extract the exact phrase the user said for each asset
   "price of dogecoin" → symbols: ["dogecoin"]
   "How is Apple doing?" → symbols: ["Apple"]
   "bitcoin and ethereum" → symbols: ["bitcoin", "ethereum"]
   "AAPL and TSLA" → symbols: ["AAPL", "TSLA"] (keep as-is; lookup will match)

2. One asset per array entry; preserve the user's wording (e.g. "Dogecoin", "Apple Inc" if that's what they said).

3. ask_user: Set ONLY when the message mentions an asset in a truly ambiguous way (e.g. "apple" with no financial context). Do NOT set for clear tickers or common names like "bitcoin", "Tesla".

4. No symbol: If the message has no asset mention (e.g. "show prices", "market data"), return symbols: [] and ask_user: null.

OUTPUT FORMAT: Strict JSON
{
  "market_data": { "symbols": ["dogecoin"], "metrics": ["price"] },
  "fact_check": { "symbols": ["dogecoin"] },
  "ask_user": null
}

Return a key for EACH selected tool. If both market_data and fact_check are selected, use the SAME symbols array in both.`,
                  role: 'system'
                },
                ...conversation.slice(-4).map(({ content: pastContent, role }) => ({
                  content: pastContent,
                  role
                })),
                {
                  content: `User message: "${message}"\nSelected tools: ${selectedTools.join(', ')}\n\nReturn JSON with a key for EACH selected tool. Use the exact asset names/phrases from the message as symbols (e.g. ["dogecoin"], ["Apple"]); do not convert to tickers—the lookup API will resolve them. Set ask_user only if truly ambiguous.`,
                  role: 'user'
                }
              ]
            });
            if (!content) {
              logger.debug('[llm.generate_tool_parameters] OUTPUT (empty)', {});
              return Object.fromEntries(selectedTools.map((tool) => [tool, undefined]));
            }
            try {
              const parsed = JSON.parse(content) as Record<string, unknown>;
              const askUser =
                typeof parsed.ask_user === 'string' && parsed.ask_user.length > 0
                  ? parsed.ask_user
                  : null;
              if (askUser) {
                logger.debug('[llm.generate_tool_parameters] OUTPUT (ask_user)', {
                  guidance: askUser
                });
                const result: Record<string, Record<string, unknown> | undefined | string | null> =
                  Object.fromEntries(selectedTools.map((tool) => [tool, undefined]));
                result.ask_user = askUser;
                return result;
              }
              const result: Record<string, Record<string, unknown> | undefined | string | null> =
                Object.fromEntries(
                  selectedTools.map((tool) => {
                    const toolParams = parsed[tool];
                    if (!toolParams || typeof toolParams !== 'object') {
                      return [tool, undefined];
                    }
                    return [tool, toolParams as Record<string, unknown>];
                  })
                );
              if (
                selectedTools.includes('market_data') &&
                selectedTools.includes('fact_check')
              ) {
                const marketDataResult = result.market_data;
                if (
                  marketDataResult &&
                  typeof marketDataResult === 'object' &&
                  !Array.isArray(marketDataResult)
                ) {
                  const marketDataSymbols =
                    (marketDataResult.symbols as string[] | undefined) || [];
                  if (marketDataSymbols.length > 0) {
                    const factCheckParams = result.fact_check;
                    const factCheckObj =
                      factCheckParams &&
                      typeof factCheckParams === 'object' &&
                      !Array.isArray(factCheckParams)
                        ? (factCheckParams as Record<string, unknown>)
                        : {};
                    result.fact_check = {
                      ...factCheckObj,
                      symbols: marketDataSymbols
                    };
                  }
                }
              }
              logger.debug('[llm.generate_tool_parameters] OUTPUT', {
                selectedTools,
                generatedParameters: selectedTools.map((tool) => {
                  const params = result[tool];
                  const str = params != null ? JSON.stringify(params) : '';
                  return {
                    tool,
                    hasParams: Boolean(params),
                    symbols: (params as Record<string, unknown>)?.symbols,
                    params: str.slice(0, 100)
                  };
                })
              });
              return result;
            } catch (parseError) {
              logger.warn('[llm.generate_tool_parameters] JSON parse failed', {
                contentPreview: content.slice(0, 100),
                error: parseError instanceof Error ? parseError.message : String(parseError)
              });
              return Object.fromEntries(selectedTools.map((tool) => [tool, undefined]));
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const code = (error as Error & { code?: string }).code;
            logger.warn('[llm.generate_tool_parameters] API_FAILED', {
              errorCode: code,
              errorMessage: errorMsg,
              selectedTools
            });
            return Object.fromEntries(selectedTools.map((tool) => [tool, undefined]));
          }
        },
        step: 'llm.generate_tool_parameters',
        traceContext
      });
    }
  };
}
