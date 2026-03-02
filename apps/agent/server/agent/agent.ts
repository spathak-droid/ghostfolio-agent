import { traceable } from 'langsmith/traceable';
import {
  AgentLlm,
  AgentChatRequest,
  AgentChatResponse,
  AgentFeedbackMemoryProvider,
  AgentTraceStep,
  AgentTools
} from '../types';
import { createDefaultContextManager, type AgentContextManager } from './context-manager';
import {
  createInMemoryConversationStore,
  type AgentConversationStore
} from '../stores';
import { logger } from '../utils';
import { scoreConfidence } from '../verification/confidence-scorer';
import {
  ensurePendingClarificationTool,
  enforceHoldingsAnalysisForAssetQuestions,
  mergeCreateOrderParams,
  normalizeOrderToolsForIntent,
  preventComplianceBlockingSpecializedTools,
  preventOrderReplayWithoutPending,
  prioritizeExecutionToolsForIntent,
  orderToolsByDependency,
  sanitizeAnalyzeStockTrendForScope,
  sanitizePortfolioHoldingsToolScope,
  sanitizeOrderToolsForNonOrderRequests,
  isOrderConfirmationMessage,
  hasPendingOrderClarification
} from './routing';
import {
  persistConversationArtifacts,
  safeGetConversation,
  safeGetState
} from './workflow-state';
import {
  createTraceContext,
  hasUsableToolData,
  timeoutMessageForOperation
} from './tool-runtime';
import {
  decideRoute,
  finalizeDirectResponse,
  handleNoToolRoute
} from './llm-runtime';
import { synthesizeAndFinalizeResponse } from '../orchestration/synthesis-stage';
import { isSimpleAffirmation } from './agent-helpers';
import { buildToolFailureResponseFromErrors } from './agent-failure-responses';
import { runToolExecutionPhase } from './agent-execute-tools';
const defaultConversationStore = createInMemoryConversationStore();
const defaultContextManager = createDefaultContextManager();
// Error policy: see docs/agent/error-handling-policy.md
// Expected runtime failures are encoded in AgentChatResponse.errors/toolCalls (HTTP 200 path).
// Unexpected boundary failures are handled by /chat with HTTP 500 AGENT_CHAT_FAILED.

export function createAgent({
  contextManager = defaultContextManager,
  conversationStore = defaultConversationStore,
  feedbackMemoryProvider,
  llm,
  tools
}: {
  contextManager?: AgentContextManager;
  conversationStore?: AgentConversationStore;
  feedbackMemoryProvider?: AgentFeedbackMemoryProvider;
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
      regulations,
      range,
      symbol,
      symbols,
      take,
      token,
      type,
      userId,
      wantsLatest
    }: AgentChatRequest): Promise<AgentChatResponse> => {
      const chatStartedAt = Date.now();
      let toolExecutionDurationMs = 0;
      const synthesisDurationMs = 0;
      const persistedConversation = await safeGetConversation({
        conversationId,
        conversationStore
      });
      const persistedState = await safeGetState({
        conversationId,
        conversationStore
      });
      const baseCreateOrderParams = mergeCreateOrderParams(
        persistedState?.pendingTool === 'create_order' ||
          persistedState?.pendingTool === 'create_other_activities'
          ? persistedState.draftCreateOrderParams
          : undefined,
        requestCreateOrderParams
      );
      const conversation = [...persistedConversation];
      conversation.push({ content: message, role: 'user' });

      // Check if this is an affirmation to a pending symbol clarification
      let effectiveMessage = message;
      if (persistedState?.pendingSymbolClarification && isSimpleAffirmation(message)) {
        const { suggestedSymbol, suggestedDisplay } = persistedState.pendingSymbolClarification;
        logger.debug('[agent.chat] AFFIRMATION_DETECTED', {
          pendingSymbol: suggestedSymbol,
          display: suggestedDisplay
        });
        // Modify the message to use the suggested symbol
        effectiveMessage = `What is the price of ${suggestedSymbol}?`;
        // Update conversation to reflect the substitution
        conversation[conversation.length - 1].content = effectiveMessage;
      }
      const llmConversationBase = contextManager.buildContext({
        conversation,
        state: persistedState
      });
      const errors: AgentChatResponse['errors'] = [];
      const toolCalls: AgentChatResponse['toolCalls'] = [];
      const trace: AgentTraceStep[] = [];
      const llmConversation = llmConversationBase;
      const traceContext = createTraceContext({ conversationId, conversation, message });

      logger.debug('[agent.chat] START', {
        conversationId,
        message,
        conversationLength: conversation.length
      });

      const routeStartedAt = Date.now();
      const routeDecision = await decideRoute({
        conversation: llmConversation,
        llm,
        message: effectiveMessage,
        traceContext
      });
      const routeDurationMs = Date.now() - routeStartedAt;
      const selectedTools = preventOrderReplayWithoutPending({
        message: effectiveMessage,
        pendingState: persistedState,
        selectedTools: sanitizeAnalyzeStockTrendForScope({
          message: effectiveMessage,
          selectedTools: enforceHoldingsAnalysisForAssetQuestions({
            message: effectiveMessage,
            selectedTools: sanitizePortfolioHoldingsToolScope({
              message: effectiveMessage,
              selectedTools: sanitizeOrderToolsForNonOrderRequests({
                message: effectiveMessage,
                pendingState: persistedState,
                selectedTools: normalizeOrderToolsForIntent({
                  message: effectiveMessage,
                  selectedTools: preventComplianceBlockingSpecializedTools({
                    message: effectiveMessage,
                    selectedTools: orderToolsByDependency({
                      selectedTools: prioritizeExecutionToolsForIntent({
                        message: effectiveMessage,
                        selectedTools: ensurePendingClarificationTool({
                          message: effectiveMessage,
                          pendingState: persistedState,
                          selectedTools: routeDecision.tools
                        })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      });
      const intent = routeDecision.intent;

      logger.debug('[agent.chat] ROUTE', {
        intent,
        routeDurationMs,
        selectedTools,
        selectedToolsCount: selectedTools.length,
        toolCount: selectedTools.length
      });

      trace.push({
        type: 'llm',
        durationMs: routeDurationMs,
        name: 'route',
        input: { messagePreview: message.slice(0, 200), conversationLength: conversation.length },
        output: { intent, selectedTools }
      });

      // Generate LLM-parsed tool parameters
      let toolParameters: Record<string, Record<string, unknown> | undefined> = {};
      let askUserClarification: string | null = null;
      logger.debug('[agent] LLM available?', { hasLlm: !!llm, hasGenerateToolParameters: !!llm?.generateToolParameters, selectedToolsLength: selectedTools.length });
      if (llm?.generateToolParameters && selectedTools.length > 0) {
        const paramStartedAt = Date.now();
        logger.debug('[agent] Calling generateToolParameters...');
        try {
          const result = await llm.generateToolParameters(message, selectedTools, llmConversation, traceContext);
          logger.debug('[agent] generateToolParameters returned:', { result });
          // Extract ask_user if present
          askUserClarification = (result.ask_user as string | undefined) || null;
          // Get tool parameters (exclude ask_user field)
          toolParameters = Object.fromEntries(
            Object.entries(result).filter(([key]) => key !== 'ask_user')
          ) as Record<string, Record<string, unknown> | undefined>;

          const paramDurationMs = Date.now() - paramStartedAt;
          logger.debug('[agent.chat] GENERATE_TOOL_PARAMETERS', {
            durationMs: paramDurationMs,
            message: message.slice(0, 100),
            selectedTools,
            perTool: selectedTools.map((t) => {
              const tp = toolParameters[t];
              return { tool: t, hasParams: Boolean(tp), symbols: (tp?.symbols as unknown) };
            }),
            needsClarification: Boolean(askUserClarification)
          });
          trace.push({
            type: 'llm',
            durationMs: paramDurationMs,
            name: 'generate_tool_parameters',
            input: { messagePreview: message.slice(0, 200), selectedTools },
            output: {
              hasParameters: Object.values(toolParameters).some((p) => p !== undefined),
              needsClarification: Boolean(askUserClarification)
            }
          });
        } catch (error) {
          logger.error('[agent] generateToolParameters ERROR:', error);
          logger.warn('[agent.chat] GENERATE_TOOL_PARAMETERS_FAILED', {
            error: error instanceof Error ? error.message : String(error)
          });
          // Graceful fallback: continue with undefined tool parameters
        }
      }

      // If LLM identified ambiguity/needs clarification, ask user instead of calling tools
      if (askUserClarification && selectedTools.length > 0) {
        logger.debug('[agent.chat] CLARIFICATION_NEEDED', {
          message: askUserClarification
        });
        return {
          answer: askUserClarification,
          conversation,
          errors: [],
          toolCalls: [],
          trace,
          verification: { confidence: 0, flags: ['needs_clarification'], isValid: false }
        };
      }

      if (selectedTools.length === 0) {
        const noToolResponse = await handleNoToolRoute({
          conversation,
          conversationId,
          conversationStore,
          errors,
          llm,
          llmConversation,
          message,
          pendingClarification: hasPendingOrderClarification(persistedState),
          previousState: persistedState,
          toolCalls,
          trace,
          traceContext,
          treatAsOrderConfirmation: isOrderConfirmationMessage(message)
        });
        logger.debug('[agent.chat] LATENCY', {
          routeDurationMs,
          selectedToolsCount: selectedTools.length,
          synthesisDurationMs,
          toolExecutionDurationMs,
          totalDurationMs: Date.now() - chatStartedAt
        });
        return noToolResponse;
      }

      const phaseResult = await runToolExecutionPhase({
        baseCreateOrderParams,
        conversation,
        conversationId,
        conversationStore,
        dateFrom,
        dateTo,
        errors,
        impersonationId,
        llm,
        llmConversation,
        message,
        metrics,
        persistedState,
        range,
        requestCreateOrderParams,
        regulations,
        selectedTools,
        symbol,
        symbols,
        take,
        token,
        toolCalls,
        toolParameters,
        tools,
        trace,
        traceContext,
        type,
        wantsLatest
      });

      if (phaseResult.kind === 'failure') {
        return phaseResult.response;
      }

      const latestCreateOrderParams = phaseResult.latestCreateOrderParams;
      toolExecutionDurationMs = phaseResult.toolExecutionDurationMs;

      if (toolCalls.every(({ success }) => !success)) {
          const hasTimeoutFailure = errors.some(({ code }) => code === 'TOOL_EXECUTION_TIMEOUT');
          if (hasTimeoutFailure) {
            const timeoutAnswer = timeoutMessageForOperation('tool.batch');
            const timeoutResponse: AgentChatResponse = {
              answer: timeoutAnswer,
              conversation: [
                ...conversation,
                {
                  content: timeoutAnswer,
                  role: 'assistant'
                }
              ],
              errors,
              toolCalls,
              trace,
              verification: {
                confidence: scoreConfidence({ hasErrors: true, invalid: true }),
                flags: ['tool_timeout'],
                isValid: false
              }
            };
            await persistConversationArtifacts({
              conversationId,
              conversationStore,
              previousState: persistedState,
              response: timeoutResponse,
              toolCalls
            });
            logger.debug('[agent.chat] LATENCY', {
              routeDurationMs,
              selectedToolsCount: selectedTools.length,
              synthesisDurationMs,
              toolExecutionDurationMs,
              totalDurationMs: Date.now() - chatStartedAt
            });
            return timeoutResponse;
          }
          const failureResponse = buildToolFailureResponseFromErrors({
            conversation,
            errors,
            llm,
            toolCalls,
            trace
          });
          await persistConversationArtifacts({
            conversationId,
            conversationStore,
            previousState: persistedState,
            response: failureResponse,
            toolCalls
          });
          logger.debug('[agent.chat] LATENCY', {
            routeDurationMs,
            selectedToolsCount: selectedTools.length,
            synthesisDurationMs,
            toolExecutionDurationMs,
            totalDurationMs: Date.now() - chatStartedAt
          });
          return failureResponse;
        }

        if (!hasUsableToolData(toolCalls)) {
          if (errors.length > 0) {
            const failureResponse = buildToolFailureResponseFromErrors({
              conversation,
              errors,
              llm,
              toolCalls,
              trace
            });
            await persistConversationArtifacts({
              conversationId,
              conversationStore,
              draftCreateOrderParams: latestCreateOrderParams,
              previousState: persistedState,
              response: failureResponse,
              toolCalls
            });
            logger.debug('[agent.chat] LATENCY', {
              routeDurationMs,
              selectedToolsCount: selectedTools.length,
              synthesisDurationMs,
              toolExecutionDurationMs,
              totalDurationMs: Date.now() - chatStartedAt
            });
            return failureResponse;
          }

          if (llm) {
            const directResponse = await finalizeDirectResponse({
              conversation,
              conversationId,
              conversationStore,
              draftCreateOrderParams: latestCreateOrderParams,
              errors,
              hasCriticalFlags: true,
              llm,
              llmConversation,
              message,
              previousState: persistedState,
              toolCalls,
              trace,
              traceContext,
              verificationFlags: ['tool_empty_result']
            });
            logger.debug('[agent.chat] LATENCY', {
              routeDurationMs,
              selectedToolsCount: selectedTools.length,
              synthesisDurationMs,
              toolExecutionDurationMs,
              totalDurationMs: Date.now() - chatStartedAt
            });
            return directResponse;
          }
        }

        return synthesizeAndFinalizeResponse({
          chatStartedAt,
          conversation,
          conversationId,
          conversationStore,
          draftCreateOrderParams: latestCreateOrderParams,
          errors,
          feedbackMemoryProvider,
          intent,
          llm,
          llmConversation,
          message,
          previousState: persistedState,
          routeDurationMs,
          selectedToolsCount: selectedTools.length,
          toolCalls,
          toolExecutionDurationMs,
          trace,
          traceContext,
          userId: userId
        });
    },
    { name: 'agent.chat', run_type: 'chain' }
  );

  return {
    chat: tracedChat
  };
}

