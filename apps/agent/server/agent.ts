import { traceable } from 'langsmith/traceable';

import {
  AgentLlm,
  AgentChatRequest,
  AgentChatResponse,
  AgentConversationMessage,
  AgentTraceContext,
  AgentTraceStep,
  AgentToolName,
  AgentTools
} from './types';
import {
  isTransactionDependentTool,
  SELECTABLE_TOOL_NAMES,
  TRANSACTION_DEPENDENT_TOOL_NAMES
} from './tools/tool-registry';
import { scoreConfidence } from './verification/confidence-scorer';
import { applyDomainConstraints } from './verification/domain-constraints';
import { validateOutput } from './verification/output-validator';
import { synthesizeToolResults } from './synthesis/tool-result-synthesizer';

const memory = new Map<string, AgentConversationMessage[]>();

export function createAgent({
  llm,
  tools
}: {
  llm?: AgentLlm;
  tools: AgentTools;
}) {
  const tracedChat = traceable(
    async ({
      conversationId,
      createOrderParams: requestCreateOrderParams,
      dateFrom,
      dateTo,
      impersonationId,
      metrics,
      message,
      range,
      symbol,
      symbols,
      take,
      token,
      type,
      updateOrderParams: requestUpdateOrderParams,
      wantsLatest
    }: AgentChatRequest): Promise<AgentChatResponse> => {
      const conversation = [...(memory.get(conversationId) ?? [])];
      conversation.push({ content: message, role: 'user' });
      const traceContext = createTraceContext({ conversationId, conversation, message });

      console.log('[agent.chat] START', {
        conversationId,
        message,
        conversationLength: conversation.length
      });

      const errors: AgentChatResponse['errors'] = [];
      const toolCalls: AgentChatResponse['toolCalls'] = [];
      const trace: AgentTraceStep[] = [];

      const routeDecision = await decideRoute({
        conversation,
        llm,
        message,
        traceContext
      });
      const selectedTools = routeDecision.tools;
      const intent = routeDecision.intent;

      console.log('[agent.chat] ROUTE', {
        intent,
        selectedTools,
        toolCount: selectedTools.length
      });

      trace.push({
        type: 'llm',
        name: 'route',
        input: { messagePreview: message.slice(0, 200), conversationLength: conversation.length },
        output: { intent, selectedTools }
      });

      // #region agent log
      fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
        body: JSON.stringify({
          sessionId: '2ea507',
          location: 'agent.ts:routeDecision',
          message: 'route decision after decideRoute',
          data: { intent, toolCount: selectedTools.length, tools: selectedTools },
          timestamp: Date.now(),
          hypothesisId: 'route'
        })
      }).catch(() => undefined);
      // #endregion

      if (selectedTools.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ea507' },
          body: JSON.stringify({
            sessionId: '2ea507',
            location: 'agent.ts:no-tools-branch',
            message: 'selectedTools.length===0, deciding answer source',
            data: { hasLlm: Boolean(llm), messagePreview: message.slice(0, 80) },
            timestamp: Date.now(),
            hypothesisId: 'A'
          })
        }).catch(() => undefined);
        // #endregion
        const baseAnswer = llm
          ? await llm.answerFinanceQuestion(message, conversation, traceContext)
          : 'I can help with portfolio, market data, or transaction categorization questions.';
        console.log('[agent.chat] NO_TOOLS_DIRECT_ANSWER', {
          messagePreview: message.slice(0, 80),
          answerLength: baseAnswer.length,
          answerPreview: baseAnswer.slice(0, 300) + (baseAnswer.length > 300 ? '...' : '')
        });
        const outputValidation = validateOutput(baseAnswer);
        const inputFlags = detectInputFlags(message);
        const constraints = applyDomainConstraints(baseAnswer, [
          ...outputValidation.errors,
          ...inputFlags
        ], {
          intent
        });

        trace.push({
          type: 'llm',
          name: 'answer',
          input: { messagePreview: message.slice(0, 200) },
          output: { answerPreview: baseAnswer.slice(0, 500) }
        });
        const response: AgentChatResponse = {
          answer: baseAnswer,
          conversation: [
            ...conversation,
            {
              content: baseAnswer,
              role: 'assistant'
            }
          ],
          errors,
          toolCalls,
          trace,
          verification: {
            confidence: scoreConfidence({
              hasErrors: false,
              invalid: !constraints.isValid
            }),
            flags: constraints.flags,
            isValid: constraints.isValid
          }
        };

        memory.set(conversationId, response.conversation);
        return response;
      }

      try {
        for (const tool of selectedTools) {
          if (isTransactionDependentTool(tool)) {
            await runTransactionsDependentFlow({
              dateFrom,
              dateTo,
              dependentTool: tool,
              errors,
              impersonationId,
              message,
              range,
              symbol,
              take,
              token,
              toolCalls,
              tools,
              trace,
              traceContext,
              type,
              wantsLatest
            });
            continue;
          }

          try {
            let createOrderParams = requestCreateOrderParams;
            let updateOrderParams = requestUpdateOrderParams;
            if (
              (tool === 'create_order' || tool === 'update_order') &&
              llm?.getToolParametersForOrder
            ) {
              const extracted = await llm.getToolParametersForOrder(
                message,
                conversation,
                tool,
                traceContext
              );
              if (extracted) {
                if (tool === 'create_order') {
                  createOrderParams = {
                    ...(extracted as import('./types').CreateOrderParams),
                    ...(requestCreateOrderParams ?? {})
                  };
                } else {
                  updateOrderParams = {
                    ...(extracted as import('./types').UpdateOrderParams),
                    ...(requestUpdateOrderParams ?? {})
                  };
                }
              }
            }
            const result = await executeTool({
              dateFrom,
              dateTo,
              impersonationId,
              metrics,
              message,
              range,
              symbol,
              symbols,
              take,
              token,
              tool,
              tools,
              traceContext,
              type,
              wantsLatest,
              createOrderParams,
              updateOrderParams
            });
            toolCalls.push({
              result,
              success: true,
              toolName: tool
            });
            trace.push({
              type: 'tool',
              name: tool,
              input: { messagePreview: message.slice(0, 200) },
              output: result
            });
            console.log('[agent.chat] TOOL_RESULT', {
              tool,
              success: true,
              resultKeys: typeof result === 'object' && result !== null ? Object.keys(result as object) : [],
              resultPreview:
                typeof result === 'object' && result !== null
                  ? JSON.stringify(result).slice(0, 500) + (JSON.stringify(result).length > 500 ? '...' : '')
                  : String(result)
            });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'unknown tool failure';
            errors.push({
              code: 'TOOL_EXECUTION_FAILED',
              message: errMsg,
              recoverable: true
            });

            console.log('[agent.chat] TOOL_RESULT', {
              tool,
              success: false,
              error: errMsg
            });

            toolCalls.push({
              result: { reason: 'tool_failure' },
              success: false,
              toolName: tool
            });
            trace.push({
              type: 'tool',
              name: tool,
              input: { messagePreview: message.slice(0, 200) },
              output: { reason: 'tool_failure', error: errMsg }
            });
          }
        }

        if (toolCalls.every(({ success }) => !success)) {
          if (llm) {
            return finalizeDirectResponse({
              conversation,
              conversationId,
              errors,
              hasCriticalFlags: true,
              llm,
              message,
              toolCalls,
              trace,
              traceContext,
              verificationFlags: ['tool_failure']
            });
          }

          const authFailure = errors.some(({ message: errorMessage }) =>
            /Ghostfolio API request failed: (401|403)/.test(errorMessage)
          );
          const failureAnswer =
            authFailure
              ? 'I could not access your Ghostfolio data because authentication failed. Please sign in again and retry.'
              : 'I could not complete the request because all selected tools failed. Please retry.';
          const failureResponse: AgentChatResponse = {
            answer: failureAnswer,
            conversation: [
              ...conversation,
              {
                content: failureAnswer,
                role: 'assistant'
              }
            ],
            errors,
            toolCalls,
            trace,
            verification: {
              confidence: scoreConfidence({ hasErrors: true, invalid: true }),
              flags: ['tool_failure'],
              isValid: false
            }
          };

          memory.set(conversationId, failureResponse.conversation);
          return failureResponse;
        }

        if (!hasUsableToolData(toolCalls) && llm) {
          return finalizeDirectResponse({
            conversation,
            conversationId,
            errors,
            hasCriticalFlags: true,
            llm,
            message,
            toolCalls,
            trace,
            traceContext,
            verificationFlags: ['tool_empty_result']
          });
        }

        const synthesized = await traceable(
          async (input: { existingFlags: string[]; toolCalls: AgentChatResponse['toolCalls'] }) =>
            synthesizeToolResults(input),
          {
            metadata: buildTraceMetadata({
              step: 'agent.synthesize_tool_results',
              traceContext
            }),
            name: `agent.synthesize_tool_results.turn_${traceContext.turnId}`,
            run_type: 'chain',
            tags: buildTraceTags({
              step: 'agent.synthesize_tool_results',
              traceContext
            })
          }
        )(
          {
          existingFlags: [],
          toolCalls
          }
        );

        console.log('[agent.chat] SYNTHESIZED', {
          answerLength: synthesized.answer.length,
          answerPreview: synthesized.answer.slice(0, 400) + (synthesized.answer.length > 400 ? '...' : ''),
          flags: synthesized.flags,
          toolCallCount: toolCalls.length
        });

        trace.push({
          type: 'llm',
          name: 'synthesize',
          input: { messagePreview: message.slice(0, 200), toolCallCount: toolCalls.length },
          output: { answerPreview: synthesized.answer.slice(0, 500), flags: synthesized.flags }
        });

        let baseAnswer = synthesized.answer;
        if (llm?.synthesizeFromToolResults) {
          const clarification = getClarificationAnswerFromToolCalls(toolCalls);
          if (clarification) {
            baseAnswer = clarification;
          } else {
            try {
              const llmAnswer = await llm.synthesizeFromToolResults(
                message,
                conversation,
                synthesized.answer,
                traceContext
              );
              if (typeof llmAnswer === 'string' && llmAnswer.trim().length > 0) {
                baseAnswer = llmAnswer.trim();
              }
            } catch {
              baseAnswer = synthesized.answer;
            }
          }
        }

        const outputValidation = validateOutput(baseAnswer);
        const inputFlags = detectInputFlags(message);
        const constraints = applyDomainConstraints(baseAnswer, [
          ...synthesized.flags,
          ...outputValidation.errors,
          ...inputFlags
        ], {
          intent
        });
        const hasCriticalFlags = constraints.flags.some((flag) =>
          ['missing_provenance', 'tool_failure'].includes(flag)
        );

        const finalizeInput = {
          answer: baseAnswer,
          constraints,
          conversation,
          errors,
          hasCriticalFlags,
          toolCalls
        };
        console.log('[agent.chat] FINALIZE_INPUT', {
          answerLength: baseAnswer.length,
          answerPreview: baseAnswer.slice(0, 300) + (baseAnswer.length > 300 ? '...' : ''),
          constraintsIsValid: constraints.isValid,
          constraintFlags: constraints.flags,
          errorCount: errors.length,
          toolCallCount: toolCalls.length
        });

        const response: AgentChatResponse = await traceable(
          async (input: {
            answer: string;
            constraints: ReturnType<typeof applyDomainConstraints>;
            conversation: AgentConversationMessage[];
            errors: AgentChatResponse['errors'];
            hasCriticalFlags: boolean;
            toolCalls: AgentChatResponse['toolCalls'];
          }) => {
            return {
              answer: input.answer,
              conversation: [
                ...input.conversation,
                {
                  content: input.answer,
                  role: 'assistant' as const
                }
              ],
              errors: input.errors,
              toolCalls: input.toolCalls,
              verification: {
                confidence: scoreConfidence({
                  hasCriticalFlags: input.hasCriticalFlags,
                  hasErrors: input.errors.length > 0,
                  invalid: !input.constraints.isValid
                }),
                flags: input.constraints.flags,
                isValid: input.constraints.isValid
              }
            } satisfies AgentChatResponse;
          },
          {
            metadata: buildTraceMetadata({
              step: 'agent.finalize_response',
              traceContext
            }),
            name: `agent.finalize_response.turn_${traceContext.turnId}`,
            run_type: 'chain',
            tags: buildTraceTags({
              step: 'agent.finalize_response',
              traceContext
            })
          }
        )(finalizeInput);
        memory.set(conversationId, response.conversation);
        (response as AgentChatResponse).trace = trace;

        console.log('[agent.chat] FINALIZE_OUTPUT', {
          answerLength: response.answer.length,
          answerPreview: response.answer.slice(0, 300) + (response.answer.length > 300 ? '...' : ''),
          verification: response.verification
        });

        return response as AgentChatResponse;
      } catch (error) {
        const failureAnswer =
          'I could not complete the request because a tool failed. Please retry.';
        const errMsg = error instanceof Error ? error.message : 'unknown tool failure';
        // #region agent log
        fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8ff55f' },
          body: JSON.stringify({
            sessionId: '8ff55f',
            location: 'agent.ts:chat catch',
            message: 'Agent returned tool failure',
            data: { errMsg, errName: error instanceof Error ? (error as Error).name : 'unknown' },
            timestamp: Date.now(),
            hypothesisId: 'C'
          })
        }).catch(() => { /* ingest may be unavailable */ });
        // #endregion
        errors.push({
          code: 'TOOL_EXECUTION_FAILED',
          message: errMsg,
          recoverable: true
        });

        toolCalls.push({
          result: { reason: 'tool_failure' },
          success: false,
          toolName: selectedTools[0] ?? 'transaction_categorize'
        });

        const failureResponse: AgentChatResponse = {
          answer: failureAnswer,
          conversation: [
            ...conversation,
            {
              content: failureAnswer,
              role: 'assistant'
            }
          ],
          errors,
          toolCalls,
          trace,
          verification: {
            confidence: scoreConfidence({ hasErrors: true, invalid: true }),
            flags: ['tool_failure'],
            isValid: false
          }
        };

        memory.set(conversationId, failureResponse.conversation);

        return failureResponse;
      }
    },
    { name: 'agent.chat', run_type: 'chain' }
  );

  return {
    chat: tracedChat
  };
}

function detectInputFlags(message: string): string[] {
  const normalized = message.toLowerCase();
  const flags: string[] = [];

  if (
    normalized.includes('invest all your money') ||
    normalized.includes('guaranteed return')
  ) {
    flags.push('deterministic_financial_advice');
  }

  return flags;
}

/**
 * When the only tool result is a clarification (needsClarification + answer), return that answer
 * so we use it directly instead of sending to the LLM (which may reply "I cannot execute trades").
 */
function getClarificationAnswerFromToolCalls(
  toolCalls: AgentChatResponse['toolCalls']
): string | undefined {
  if (toolCalls.length !== 1 || !toolCalls[0].success) return undefined;
  const result = toolCalls[0].result as Record<string, unknown>;
  if (result?.needsClarification !== true) return undefined;
  const answer = typeof result.answer === 'string' ? result.answer.trim() : undefined;
  return answer && answer.length > 0 ? answer : undefined;
}

async function executeTool({
  dateFrom,
  dateTo,
  impersonationId,
  metrics,
  message,
  range,
  symbol,
  symbols,
  take,
  traceContext,
  token,
  tool,
  tools,
  type,
  wantsLatest,
  createOrderParams,
  updateOrderParams
}: {
  dateFrom?: string;
  dateTo?: string;
  impersonationId?: string;
  metrics?: string[];
  message: string;
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  traceContext: AgentTraceContext;
  token?: string;
  tool: AgentToolName;
  tools: AgentTools;
  type?: string;
  wantsLatest?: boolean;
  createOrderParams?: import('./types').CreateOrderParams;
  updateOrderParams?: import('./types').UpdateOrderParams;
}) {
  const runtimeTrace = {
    metadata: buildTraceMetadata({
      step: `tool.${tool}`,
      traceContext
    }),
    tags: buildTraceTags({
      step: `tool.${tool}`,
      traceContext
    })
  };

  if (tool === 'portfolio_analysis') {
    return traceable(tools.portfolioAnalysis, {
      name: `tool.portfolio_analysis.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, token });
  }

  if (tool === 'market_data') {
    return traceable(tools.marketData, {
      name: `tool.market_data.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, metrics, symbols, token });
  }

  if (tool === 'market_data_lookup') {
    return traceable(tools.marketDataLookup, {
      name: `tool.market_data_lookup.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, token });
  }

  if (tool === 'market_overview') {
    if (tools.marketOverview) {
      return traceable(tools.marketOverview, {
        name: `tool.market_overview.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token });
    }
    return traceable(tools.marketDataLookup, {
      name: `tool.market_data_lookup.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, token });
  }

  if (tool === 'get_transactions') {
    return traceable(tools.getTransactions, {
      name: `tool.get_transactions.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, range, take, token });
  }

  if (tool === 'transaction_timeline') {
    return traceable(tools.transactionTimeline, {
      name: `tool.transaction_timeline.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { dateFrom, dateTo, impersonationId, message, symbol, token, type, wantsLatest });
  }

  if (tool === 'create_order') {
    return traceable(tools.createOrder, {
      name: `tool.create_order.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, token, createOrderParams });
  }

  if (tool === 'update_order') {
    return traceable(tools.updateOrder, {
      name: `tool.update_order.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { impersonationId, message, token, updateOrderParams });
  }

  return traceable(tools.transactionCategorize, {
    name: `tool.transaction_categorize.turn_${traceContext.turnId}`,
    run_type: 'tool'
  })(runtimeTrace, { dateFrom, dateTo, impersonationId, message, symbol, token, type });
}

/** Keyword hints per selectable tool; used when LLM is unavailable. Registry is source of truth for tool names. */
const SELECTABLE_KEYWORD_HINTS: Readonly<Record<string, string[]>> = {
  portfolio_analysis: [
    'portfolio',
    'allocation',
    'balance',
    'cash',
    'deposit',
    'deposited',
    'available',
    'net worth',
    'how much do i have'
  ],
  market_data: [
    'price of',
    'current price',
    'bitcoin price',
    'how much difference',
    'how much was',
    'price in',
    'last week',
    'last month',
    'price from today'
  ],
  market_data_lookup: ['market data', 'fear and greed index'],
  market_overview: [
    'market overview',
    'market summary',
    'how are markets doing',
    'markets right now',
    'doing good',
    'doing bad',
    'market sentiment'
  ],
  transaction_categorize: ['transaction', 'categorize', 'category'],
  transaction_timeline: [
    'when did i buy',
    'when did i sell',
    'at what price',
    'last transaction',
    'latest transaction',
    'most recent transaction',
    'when i bought',
    'when i sold'
  ],
  create_order: [
    'buy',
    'purchase',
    'add activity',
    'record buy',
    'add order',
    'record a buy',
    'record a sell',
    'i want to buy',
    'i want to sell'
  ],
  update_order: ['update order', 'edit activity', 'change order', 'edit order', 'modify order']
};

function selectToolsByKeyword(message: string): AgentToolName[] {
  const normalized = message.toLowerCase();
  const tools: AgentToolName[] = [];

  for (const toolName of SELECTABLE_TOOL_NAMES) {
    const hints = SELECTABLE_KEYWORD_HINTS[toolName];
    if (hints?.some((hint) => normalized.includes(hint))) {
      tools.push(toolName);
    }
  }

  return [...new Set(tools)];
}

async function selectTools({
  conversation,
  llm,
  message,
  traceContext
}: {
  conversation: AgentConversationMessage[];
  llm?: AgentLlm;
  message: string;
  traceContext: AgentTraceContext;
}): Promise<AgentToolName[]> {
  const inferred = selectToolsByKeyword(message);
  if (classifyIntent(message) === 'general') {
    return [];
  }

  if (llm) {
    try {
      const selected = await llm.selectTool(message, conversation, traceContext);

      if (selected.tool === 'none') {
        return inferred;
      }

      return [...new Set([selected.tool, ...inferred])];
    } catch {
      return inferred;
    }
  }

  return inferred;
}

/**
 * Schema-driven safety net: when the router returns direct_reply but the message
 * clearly implies retrieval (time ref, price/symbol, ticker), we prefer tool_call.
 * Uses minimal regex set only; no vague heuristics.
 */
function messageMatchesRetrievalPatterns(message: string): boolean {
  const normalized = message.toLowerCase();
  if (/\b(20\d{2})\b/.test(message)) return true;
  if (/\b(last week|last month|last year|ytd|today|yesterday)\b/.test(normalized)) return true;
  if (/\b(price|quote|cost|return|performance)\b/.test(normalized)) return true;
  if (/\b[A-Z]{1,5}\b/.test(message)) return true;
  if (/\b(btc|bitcoin|eth|ethereum)\b/.test(normalized)) return true;
  return false;
}

function isExplicitOrderExecutionIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  const advisoryPatterns = [
    /\bshould i\s+(buy|sell)\b/,
    /\b(do you think|would you)\b.*\b(buy|sell)\b/,
    /\bis it (a )?good (idea )?to\s+(buy|sell)\b/,
    /\bbuy or sell\b/,
    /\bcan i\s+(buy|sell)\b/
  ];
  if (advisoryPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/^(buy|sell)\b/.test(normalized)) {
    return !normalized.includes('?');
  }

  return [
    /\b(i want to|i'd like to|please)\s+(buy|sell)\b/,
    /\b(add|record)\s+(a\s+)?(buy|sell)\b/,
    /\b(place|execute|submit|create|update)\s+(an?\s+)?order\b/,
    /\b(buy|sell)\s+\d+(\.\d+)?\s+[a-z0-9.-]+\b/
  ].some((pattern) => pattern.test(normalized));
}

async function decideRoute({
  conversation,
  llm,
  message,
  traceContext
}: {
  conversation: AgentConversationMessage[];
  llm?: AgentLlm;
  message: string;
  traceContext: AgentTraceContext;
}) {
  const inferredIntent = classifyIntent(message);
  const inferredTools = await selectTools({
    conversation,
    llm,
    message,
    traceContext
  });

  if (!llm?.reasonAboutQuery) {
    return {
      intent: inferredIntent,
      tools: inferredTools
    };
  }

  try {
    const decision = await llm.reasonAboutQuery(message, conversation, traceContext);

    if (decision.mode === 'direct_reply') {
      if (messageMatchesRetrievalPatterns(message) && inferredTools.length > 0) {
        return { intent: decision.intent, tools: inferredTools };
      }
      // When user asks to buy/sell/add/update order, keep create_order or update_order so the tool can ask for missing fields (e.g. quantity)
      const hasOrderTool = inferredTools.some(
        (t) => t === 'create_order' || t === 'update_order'
      );
      if (hasOrderTool && isExplicitOrderExecutionIntent(message)) {
        return { intent: decision.intent, tools: inferredTools };
      }
      return {
        intent: decision.intent,
        tools: [] as AgentToolName[]
      };
    }

    if (Array.isArray(decision.tools) && decision.tools.length > 0) {
      return {
        intent: decision.intent,
        tools: [...new Set([...decision.tools, ...inferredTools])]
      };
    }

    if (decision.tool && decision.tool !== 'none') {
      return {
        intent: decision.intent,
        tools: [...new Set([decision.tool, ...inferredTools])]
      };
    }
  } catch {
    return {
      intent: inferredIntent,
      tools: inferredTools
    };
  }

  return {
    intent: inferredIntent,
    tools: inferredTools
  };
}

function isSmallTalk(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    'hello',
    'hi',
    'hey',
    'yo',
    'sup',
    'thanks',
    'thank you',
    'good morning',
    'good afternoon',
    'good evening',
    'how are you'
  ].includes(normalized);
}

function classifyIntent(message: string): 'finance' | 'general' {
  if (isSmallTalk(message)) {
    return 'general';
  }

  return hasFinanceEntityOrAction(message) ? 'finance' : 'general';
}

function hasFinanceEntityOrAction(message: string) {
  const normalized = message.toLowerCase();
  const financeKeywords = [
    'portfolio',
    'allocation',
    'market',
    'price',
    'stock',
    'crypto',
    'bitcoin',
    'btc',
    'tsla',
    'tesla',
    'aapl',
    'nvda',
    'transaction',
    'buy',
    'sell',
    'holding',
    'holdings',
    'p&l',
    'performance',
    'return',
    'balance',
    'account',
    'cash',
    'interest',
    'liability',
    'ticker'
  ];

  return financeKeywords.some((keyword) => normalized.includes(keyword));
}

async function finalizeDirectResponse({
  conversation,
  conversationId,
  errors,
  hasCriticalFlags,
  llm,
  message,
  toolCalls,
  trace,
  traceContext,
  verificationFlags
}: {
  conversation: AgentConversationMessage[];
  conversationId: string;
  errors: AgentChatResponse['errors'];
  hasCriticalFlags: boolean;
  llm: AgentLlm;
  message: string;
  toolCalls: AgentChatResponse['toolCalls'];
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
  verificationFlags: string[];
}): Promise<AgentChatResponse> {
  const baseAnswer = await llm.answerFinanceQuestion(message, conversation, traceContext);
  trace.push({
    type: 'llm',
    name: 'answer',
    input: { messagePreview: message.slice(0, 200) },
    output: { answerPreview: baseAnswer.slice(0, 500) }
  });
  const outputValidation = validateOutput(baseAnswer);
  const inputFlags = detectInputFlags(message);
  const constraints = applyDomainConstraints(
    baseAnswer,
    [...verificationFlags, ...outputValidation.errors, ...inputFlags],
    { intent: classifyIntent(message) }
  );
  const response: AgentChatResponse = {
    answer: baseAnswer,
    conversation: [
      ...conversation,
      {
        content: baseAnswer,
        role: 'assistant'
      }
    ],
    errors,
    toolCalls,
    trace,
    verification: {
      confidence: scoreConfidence({
        hasCriticalFlags,
        hasErrors: errors.length > 0,
        invalid: !constraints.isValid
      }),
      flags: constraints.flags,
      isValid: constraints.isValid
    }
  };

  memory.set(conversationId, response.conversation);
  return response;
}

function hasUsableToolData(toolCalls: AgentChatResponse['toolCalls']) {
  return toolCalls.some(({ result, success }) => {
    if (!success) {
      return false;
    }

    if (!isObject(result)) {
      return false;
    }

    if (hasPopulatedField(result, 'summary')) {
      return true;
    }

    if (hasPopulatedArray(result, 'prices')) {
      return true;
    }

    if (hasPopulatedArray(result, 'timeline')) {
      return true;
    }

    if (hasPopulatedArray(result, 'categories')) {
      return true;
    }

    if (hasPopulatedArray(result, 'transactions')) {
      return true;
    }

    const data = result.data;
    if (!isObject(data)) {
      return false;
    }

    return (
      hasPopulatedArray(data, 'activities') ||
      hasPopulatedObject(data, 'holdings') ||
      hasPopulatedObject(data, 'summary')
    );
  });
}

function hasPopulatedField(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return typeof item === 'string' ? item.trim().length > 0 : Boolean(item);
}

function hasPopulatedArray(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return Array.isArray(item) && item.length > 0;
}

function hasPopulatedObject(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return isObject(item) && Object.keys(item).length > 0;
}

function buildTraceMetadata({
  step,
  traceContext
}: {
  step: string;
  traceContext: AgentTraceContext;
}) {
  return {
    conversation_id: traceContext.conversationId,
    message_preview: traceContext.messagePreview,
    session_id: traceContext.sessionId,
    step,
    turn_id: traceContext.turnId
  };
}

function buildTraceTags({
  step,
  traceContext
}: {
  step: string;
  traceContext: AgentTraceContext;
}) {
  return [
    'agent',
    `conversation:${traceContext.conversationId}`,
    `session:${traceContext.sessionId}`,
    `step:${step}`,
    `turn:${traceContext.turnId}`
  ];
}

function createTraceContext({
  conversation,
  conversationId,
  message
}: {
  conversation: AgentConversationMessage[];
  conversationId: string;
  message: string;
}): AgentTraceContext {
  const turnId =
    conversation.filter(({ role }) => role === 'user').length;

  return {
    conversationId,
    messagePreview: message.slice(0, 120),
    sessionId: conversationId,
    turnId
  };
}

async function runTransactionsDependentFlow({
  dateFrom,
  dateTo,
  dependentTool,
  errors,
  impersonationId,
  message,
  range,
  symbol,
  take,
  token,
  toolCalls,
  tools,
  trace,
  traceContext,
  type,
  wantsLatest
}: {
  dateFrom?: string;
  dateTo?: string;
  dependentTool: (typeof TRANSACTION_DEPENDENT_TOOL_NAMES)[number];
  errors: AgentChatResponse['errors'];
  impersonationId?: string;
  message: string;
  range?: string;
  symbol?: string;
  take?: number;
  token?: string;
  toolCalls: AgentChatResponse['toolCalls'];
  tools: AgentTools;
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
  type?: string;
  wantsLatest?: boolean;
}) {
  let transactions: Record<string, unknown>[] = [];

  try {
    const transactionResult = await executeTool({
      dateFrom,
      dateTo,
      impersonationId,
      message,
      range,
      symbol,
      take,
      token,
      tool: 'get_transactions',
      tools,
      traceContext,
      type,
      wantsLatest
    });

    transactions = extractTransactions(transactionResult);
    toolCalls.push({
      result: transactionResult,
      success: true,
      toolName: 'get_transactions'
    });
    trace.push({
      type: 'tool',
      name: 'get_transactions',
      input: { messagePreview: message.slice(0, 200) },
      output: transactionResult
    });
    console.log('[agent.chat] TOOL_RESULT (transaction flow)', {
      tool: 'get_transactions',
      success: true,
      transactionCount: Array.isArray(transactions) ? transactions.length : 0,
      resultPreview:
        typeof transactionResult === 'object' && transactionResult !== null
          ? JSON.stringify(transactionResult).slice(0, 400) + '...'
          : String(transactionResult)
    });
  } catch (error) {
    errors.push({
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'failed to fetch transactions',
      recoverable: true
    });
    toolCalls.push({
      result: { reason: 'tool_failure' },
      success: false,
      toolName: 'get_transactions'
    });
    trace.push({
      type: 'tool',
      name: 'get_transactions',
      input: { messagePreview: message.slice(0, 200) },
      output: { reason: 'tool_failure' }
    });
  }

  try {
    const toolHandler =
      dependentTool === 'transaction_timeline'
        ? tools.transactionTimeline
        : tools.transactionCategorize;
    const step =
      dependentTool === 'transaction_timeline'
        ? 'tool.transaction_timeline'
        : 'tool.transaction_categorize';

    const result = await traceable(toolHandler, {
      name: `${step}.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(
      {
        metadata: buildTraceMetadata({
          step,
          traceContext
        }),
        tags: buildTraceTags({
          step,
          traceContext
        })
      },
      { dateFrom, dateTo, impersonationId, message, symbol, token, transactions, type, wantsLatest }
    );

    toolCalls.push({
      result,
      success: true,
      toolName: dependentTool
    });
    trace.push({
      type: 'tool',
      name: dependentTool,
      input: { messagePreview: message.slice(0, 200), hadTransactions: transactions.length > 0 },
      output: result
    });
    console.log('[agent.chat] TOOL_RESULT (transaction flow)', {
      tool: dependentTool,
      success: true,
      resultKeys: typeof result === 'object' && result !== null ? Object.keys(result as object) : [],
      resultPreview:
        typeof result === 'object' && result !== null
          ? JSON.stringify(result).slice(0, 500) + (JSON.stringify(result).length > 500 ? '...' : '')
          : String(result)
    });
  } catch (error) {
    errors.push({
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'unknown tool failure',
      recoverable: true
    });
    toolCalls.push({
      result: { reason: 'tool_failure' },
      success: false,
      toolName: dependentTool
    });
    trace.push({
      type: 'tool',
      name: dependentTool,
      input: { messagePreview: message.slice(0, 200) },
      output: { reason: 'tool_failure' }
    });
  }
}

function extractTransactions(result: Record<string, unknown>) {
  const directTransactions = result.transactions;
  if (Array.isArray(directTransactions)) {
    return directTransactions.filter(isObject);
  }

  const data = result.data;
  if (isObject(data) && Array.isArray(data.activities)) {
    return data.activities.filter(isObject);
  }

  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
