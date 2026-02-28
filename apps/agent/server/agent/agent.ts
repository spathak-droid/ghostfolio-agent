import { traceable } from 'langsmith/traceable';
import {
  AgentLlm,
  AgentChatRequest,
  AgentChatResponse,
  AgentFeedbackMemoryProvider,
  AgentTraceStep,
  AgentTools
} from '../types';
import {
  isTransactionDependentTool
} from '../tools/tool-registry';
import { createDefaultContextManager, type AgentContextManager } from './context-manager';
import {
  createInMemoryConversationStore,
  type AgentConversationStore
} from '../stores';
import { logger } from '../utils';
import { scoreConfidence } from '../verification/confidence-scorer';
import {
  ensurePendingClarificationTool,
  inferCreateOrderParamsFromMessage,
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
  AGENT_OPERATION_TIMEOUT_MS,
  createTraceContext,
  executeTool,
  getReportedToolFailure,
  hasUsableToolData,
  inferToolRecoverableFromThrownError,
  isTimeoutError,
  runTransactionsDependentFlow,
  timeoutMessageForOperation,
  withOperationTimeout
} from './tool-runtime';
import {
  buildToolFailureResponse,
  decideRoute,
  finalizeDirectResponse,
  handleNoToolRoute
} from './llm-runtime';
import {
  buildToolCallFailureResult,
  sanitizeErrorMessageForClient,
  toOrchestrationErrorEntry
} from '../utils';
import { synthesizeAndFinalizeResponse } from '../orchestration/synthesis-stage';
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
        message,
        traceContext
      });
      const routeDurationMs = Date.now() - routeStartedAt;
      const selectedTools = preventOrderReplayWithoutPending({
        message,
        pendingState: persistedState,
        selectedTools: sanitizeAnalyzeStockTrendForScope({
          message,
          selectedTools: enforceHoldingsAnalysisForAssetQuestions({
            message,
            selectedTools: sanitizePortfolioHoldingsToolScope({
              message,
              selectedTools: sanitizeOrderToolsForNonOrderRequests({
                message,
                pendingState: persistedState,
                selectedTools: normalizeOrderToolsForIntent({
                  message,
                  selectedTools: preventComplianceBlockingSpecializedTools({
                    message,
                    selectedTools: orderToolsByDependency({
                      selectedTools: prioritizeExecutionToolsForIntent({
                        message,
                        selectedTools: ensurePendingClarificationTool({
                          message,
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
      if (llm?.generateToolParameters && selectedTools.length > 0) {
        const paramStartedAt = Date.now();
        try {
          toolParameters = await llm.generateToolParameters(message, selectedTools, llmConversation, traceContext);
          const paramDurationMs = Date.now() - paramStartedAt;
          logger.debug('[agent.chat] GENERATE_TOOL_PARAMETERS', {
            durationMs: paramDurationMs,
            tools: Object.keys(toolParameters).join(', ')
          });
          trace.push({
            type: 'llm',
            durationMs: paramDurationMs,
            name: 'generate_tool_parameters',
            input: { messagePreview: message.slice(0, 200), selectedTools },
            output: { hasParameters: Object.values(toolParameters).some((p) => p !== undefined) }
          });
        } catch (error) {
          logger.warn('[agent.chat] GENERATE_TOOL_PARAMETERS_FAILED', {
            error: error instanceof Error ? error.message : String(error)
          });
          // Graceful fallback: continue with undefined tool parameters
        }
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

      let latestCreateOrderParams: import('../types').CreateOrderParams | undefined =
        baseCreateOrderParams;
      try {
        for (const tool of selectedTools) {
          if (isTransactionDependentTool(tool)) {
            const transactionFlowStartedAt = Date.now();
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
            const transactionFlowDurationMs = Date.now() - transactionFlowStartedAt;
            toolExecutionDurationMs += transactionFlowDurationMs;
            trace.push({
              type: 'tool',
              durationMs: transactionFlowDurationMs,
              name: `${tool}_flow`,
              input: { messagePreview: message.slice(0, 200) },
              output: { status: 'completed' }
            });
            continue;
          }

          try {
            let createOrderParams = latestCreateOrderParams;
            if (
              (tool === 'create_order' || tool === 'create_other_activities') &&
              llm?.getToolParametersForOrder
            ) {
              let extracted: Partial<import('../types').CreateOrderParams> | undefined;
              try {
                const getToolParametersForOrder = llm.getToolParametersForOrder;
                if (getToolParametersForOrder) {
                  const getToolParamsStartedAt = Date.now();
                  extracted = await withOperationTimeout({
                    operation: 'llm.get_tool_parameters_for_order',
                    task: () =>
                      getToolParametersForOrder(message, llmConversation, tool, traceContext)
                  });
                  trace.push({
                    type: 'llm',
                    durationMs: Date.now() - getToolParamsStartedAt,
                    name: 'get_tool_parameters_for_order',
                    input: { messagePreview: message.slice(0, 200), tool },
                    output: { hasParams: Boolean(extracted) }
                  });
                } else {
                  extracted = undefined;
                }
              } catch (error) {
                if (isTimeoutError(error)) {
                  errors.push({
                    code: 'LLM_EXECUTION_TIMEOUT',
                    message: 'llm.get_tool_parameters_for_order timed out after 25 seconds',
                    recoverable: true
                  });
                  extracted = undefined;
                } else {
                  errors.push({
                    code: 'LLM_EXECUTION_FAILED',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'llm.get_tool_parameters_for_order failed',
                    recoverable: true
                  });
                  extracted = undefined;
                }
              }
              if (extracted) {
                createOrderParams = mergeCreateOrderParams(
                  createOrderParams,
                  extracted as import('../types').CreateOrderParams,
                  requestCreateOrderParams
                );
              }
            }
            if (tool === 'create_order' || tool === 'create_other_activities') {
              createOrderParams = mergeCreateOrderParams(
                createOrderParams,
                inferCreateOrderParamsFromMessage(message)
              );
              latestCreateOrderParams = createOrderParams;
            }

            // Use LLM-generated tool parameters if available
            const llmToolParams = toolParameters[tool] || {};
            const toolSymbols = (llmToolParams.symbols as string[] | undefined) ?? symbols;
            const toolMetrics = (llmToolParams.metrics as string[] | undefined) ?? metrics;
            const toolRange = (llmToolParams.range as string | undefined) ?? range;
            const toolDateFrom = (llmToolParams.dateFrom as string | undefined) ?? dateFrom;
            const toolDateTo = (llmToolParams.dateTo as string | undefined) ?? dateTo;

            const toolStartedAt = Date.now();
            const result = await executeTool({
              dateFrom: toolDateFrom,
              dateTo: toolDateTo,
              impersonationId,
              metrics: toolMetrics,
              message,
              regulations,
              range: toolRange,
              symbol,
              symbols: toolSymbols,
              take,
              token,
              tool,
              tools,
              traceContext,
              type,
              wantsLatest,
              createOrderParams
            });
            const toolDurationMs = Date.now() - toolStartedAt;
            toolExecutionDurationMs += toolDurationMs;
            const reportedFailure = getReportedToolFailure(result);
            if (reportedFailure) {
              const normalizedMessage = sanitizeErrorMessageForClient(reportedFailure.message);
              const entry = toOrchestrationErrorEntry({
                isTimeout: false,
                message: normalizedMessage,
                recoverable: reportedFailure.recoverable
              });
              errors.push(entry);
              logger.debug('[agent.chat] TOOL_RESULT', {
                tool,
                success: false,
                error: normalizedMessage
              });
              toolCalls.push({
                result: buildToolCallFailureResult({
                  errorCode: entry.code,
                  message: entry.message,
                  reason: 'tool_failure',
                  retryable: entry.recoverable
                }),
                success: false,
                toolName: tool
              });
              trace.push({
                type: 'tool',
                durationMs: toolDurationMs,
                name: tool,
                input: { messagePreview: message.slice(0, 200) },
                output: { reason: 'tool_failure', error: normalizedMessage }
              });
              continue;
            }
            toolCalls.push({
              result,
              success: true,
              toolName: tool
            });
            trace.push({
              type: 'tool',
              durationMs: toolDurationMs,
              name: tool,
              input: { messagePreview: message.slice(0, 200) },
              output: result
            });
            logger.debug('[agent.chat] TOOL_RESULT', {
              tool,
              success: true,
              resultKeys: typeof result === 'object' && result !== null ? Object.keys(result as object) : [],
              resultPreview:
                typeof result === 'object' && result !== null
                  ? JSON.stringify(result).slice(0, 500) + (JSON.stringify(result).length > 500 ? '...' : '')
                  : String(result)
            });
          } catch (error) {
            const isTimeout = isTimeoutError(error);
            const rawErrorMessage = isTimeout
              ? `${tool} timed out after 25 seconds`
              : error instanceof Error
                ? error.message
                : 'unknown tool failure';
            const errMsg = sanitizeErrorMessageForClient(rawErrorMessage);
            const retryable = isTimeout ? true : inferToolRecoverableFromThrownError(error);
            const entry = toOrchestrationErrorEntry({
              isTimeout,
              message: errMsg,
              recoverable: retryable
            });
            errors.push(entry);

            logger.debug('[agent.chat] TOOL_RESULT', {
              tool,
              success: false,
              error: errMsg
            });

            toolCalls.push({
              result: buildToolCallFailureResult({
                errorCode: entry.code,
                message: entry.message,
                reason: isTimeout ? 'tool_timeout' : 'tool_failure',
                retryable: entry.recoverable
              }),
              success: false,
              toolName: tool
            });
            trace.push({
              type: 'tool',
              name: tool,
              input: { messagePreview: message.slice(0, 200) },
              output: { reason: isTimeout ? 'tool_timeout' : 'tool_failure', error: errMsg }
            });
          }
        }

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
          const authFailure = errors.some(({ message: errorMessage }) =>
            /Ghostfolio API request failed: (401|403)/.test(errorMessage)
          );
          const apiFailure = errors.some(({ message: errorMessage }) =>
            /Ghostfolio API request failed: \d{3}/.test(errorMessage) ||
            errorMessage.includes('GHOSTFOLIO_')
          );
          const firstToolError =
            errors.find(({ code }) => code === 'TOOL_EXECUTION_FAILED')?.message ??
            'I could not complete the request because all selected tools failed. Please retry.';
          const sanitizedToolError = sanitizeToolErrorMessage(firstToolError);
          const failureAnswer =
            authFailure
              ? 'I could not access your Ghostfolio data because authentication failed. Please sign in again and retry.'
              : apiFailure
                ? 'I could not fetch data from the Ghostfolio API right now. Please retry.'
                : llm
                  ? sanitizedToolError
                  : 'I could not complete the request because a tool failed. Please retry.';
          const failureResponse = buildToolFailureResponse({
            answer: failureAnswer,
            conversation,
            errors,
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
            const authFailure = errors.some(({ message: errorMessage }) =>
              /Ghostfolio API request failed: (401|403)/.test(errorMessage)
            );
            const apiFailure = errors.some(
              ({ message: errorMessage }) =>
                /Ghostfolio API request failed: \d{3}/.test(errorMessage) ||
                errorMessage.includes('GHOSTFOLIO_')
            );
            const firstToolError =
              errors.find(({ code }) => code === 'TOOL_EXECUTION_FAILED')?.message ??
              'I could not complete the request because all selected tools failed. Please retry.';
            const sanitizedToolError = sanitizeToolErrorMessage(firstToolError);
            const failureAnswer =
              authFailure
                ? 'I could not access your Ghostfolio data because authentication failed. Please sign in again and retry.'
                : apiFailure
                  ? 'I could not fetch data from the Ghostfolio API right now. Please retry.'
                  : llm
                    ? sanitizedToolError
                    : 'I could not complete the request because a tool failed. Please retry.';
            const failureResponse = buildToolFailureResponse({
              answer: failureAnswer,
              conversation,
              errors,
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
          traceContext
        });
      } catch (error) {
        const isTimeout = isTimeoutError(error);
        const failureAnswer = isTimeout
          ? timeoutMessageForOperation('tool.batch')
          : 'I could not complete the request because a tool failed. Please retry.';
        const errMsg = isTimeout
          ? `agent tool flow timed out after ${AGENT_OPERATION_TIMEOUT_MS / 1000} seconds`
          : error instanceof Error
            ? error.message
            : 'unknown tool failure';
        const normalizedErrorMessage = sanitizeErrorMessageForClient(errMsg);
        const recoverable = isTimeout ? true : inferToolRecoverableFromThrownError(error);
        const entry = toOrchestrationErrorEntry({
          isTimeout,
          message: normalizedErrorMessage,
          recoverable
        });
        errors.push(entry);

        toolCalls.push({
          result: buildToolCallFailureResult({
            errorCode: entry.code,
            message: entry.message,
            reason: isTimeout ? 'tool_timeout' : 'tool_failure',
            retryable: entry.recoverable
          }),
          success: false,
          toolName: selectedTools[0] ?? 'transaction_categorize'
        });

        const failureResponse = buildToolFailureResponse({
          answer: failureAnswer,
          conversation,
          errors,
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
    },
    { name: 'agent.chat', run_type: 'chain' }
  );

  return {
    chat: tracedChat
  };
}

function sanitizeToolErrorMessage(message: string): string {
  return sanitizeErrorMessageForClient(
    message.replace(/^TOOL_EXECUTION_(FAILED|TIMEOUT):\s*/i, '').trim()
  );
}
