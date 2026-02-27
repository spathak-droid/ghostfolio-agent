import { traceable } from 'langsmith/traceable';
import {
  AgentLlm,
  AgentChatRequest,
  AgentChatResponse,
  AgentConversationMessage,
  AgentFeedbackMemory,
  AgentFeedbackMemoryProvider,
  AgentTraceStep,
  AgentTools
} from './types';
import {
  isTransactionDependentTool
} from './tools/tool-registry';
import { createDefaultContextManager, type AgentContextManager } from './context-manager';
import {
  createInMemoryConversationStore,
  type AgentConversationStore
} from './conversation-store';
import { scoreConfidence } from './verification/confidence-scorer';
import { applyDomainConstraints } from './verification/domain-constraints';
import { validateOutput } from './verification/output-validator';
import { logger } from './logger';
import { synthesizeToolResults } from './synthesis/tool-result-synthesizer';
import {
  ensurePendingClarificationTool,
  inferCreateOrderParamsFromMessage,
  mergeCreateOrderParams,
  normalizeOrderToolsForIntent,
  preventOrderReplayWithoutPending,
  prioritizeExecutionToolsForIntent,
  sanitizeAnalyzeStockTrendForScope,
  sanitizePortfolioHoldingsToolScope,
  sanitizeOrderToolsForNonOrderRequests,
  isOrderConfirmationMessage,
  hasPendingOrderClarification
} from './agent-routing';
import {
  persistConversationArtifacts,
  safeGetConversation,
  safeGetState
} from './agent-workflow-state';
import {
  AGENT_OPERATION_TIMEOUT_MS,
  buildTraceMetadata,
  buildTraceTags,
  createTraceContext,
  executeTool,
  getReportedToolFailure,
  hasUsableToolData,
  inferToolRecoverableFromThrownError,
  isTimeoutError,
  runTransactionsDependentFlow,
  timeoutMessageForOperation,
  withOperationTimeout
} from './agent-tool-runtime';
import {
  buildToolFailureResponse,
  decideRoute,
  detectInputFlags,
  finalizeDirectResponse,
  getPreferredSingleToolAnswerFromToolCalls,
  handleNoToolRoute
} from './agent-llm-runtime';
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
      let synthesisDurationMs = 0;
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
          selectedTools: sanitizePortfolioHoldingsToolScope({
            message,
            selectedTools: sanitizeOrderToolsForNonOrderRequests({
              message,
              pendingState: persistedState,
              selectedTools: normalizeOrderToolsForIntent({
                message,
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

      let latestCreateOrderParams: import('./types').CreateOrderParams | undefined =
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
              let extracted: Partial<import('./types').CreateOrderParams> | undefined;
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
                  extracted as import('./types').CreateOrderParams,
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
            const toolStartedAt = Date.now();
            const result = await executeTool({
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
              errors.push({
                code: 'TOOL_EXECUTION_FAILED',
                message: reportedFailure.message,
                recoverable: reportedFailure.recoverable
              });
              logger.debug('[agent.chat] TOOL_RESULT', {
                tool,
                success: false,
                error: reportedFailure.message
              });
              toolCalls.push({
                result: { reason: 'tool_failure', errorMessage: reportedFailure.message },
                success: false,
                toolName: tool
              });
              trace.push({
                type: 'tool',
                durationMs: toolDurationMs,
                name: tool,
                input: { messagePreview: message.slice(0, 200) },
                output: { reason: 'tool_failure', error: reportedFailure.message }
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
            const errMsg = isTimeout
              ? `${tool} timed out after 25 seconds`
              : error instanceof Error
                ? error.message
                : 'unknown tool failure';
            errors.push({
              code: isTimeout ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_FAILED',
              message: errMsg,
              recoverable: isTimeout ? true : inferToolRecoverableFromThrownError(error)
            });

            logger.debug('[agent.chat] TOOL_RESULT', {
              tool,
              success: false,
              error: errMsg
            });

            toolCalls.push({
              result: { reason: isTimeout ? 'tool_timeout' : 'tool_failure', errorMessage: errMsg },
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
                : sanitizedToolError;
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

        if (!hasUsableToolData(toolCalls) && llm) {
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

        let feedbackMemory: AgentFeedbackMemory | undefined;
        if (feedbackMemoryProvider) {
          try {
            const toolSignature = toolCalls.map((call) => call.toolName).join('>');
            feedbackMemory = await feedbackMemoryProvider.getForToolSignature(toolSignature);
            if (feedbackMemory) {
              trace.push({
                type: 'llm',
                name: 'feedback_memory_synthesis',
                output: {
                  doCount: feedbackMemory.do.length,
                  dontCount: feedbackMemory.dont.length,
                  sources: feedbackMemory.sources,
                  synthesisIssueCount: feedbackMemory.synthesisIssues.length,
                  toolIssueCount: feedbackMemory.toolIssues.length,
                  toolSignature
                }
              });
            }
          } catch {
            feedbackMemory = undefined;
          }
        }

        const synthesizeStartedAt = Date.now();
        const synthesized = await traceable(
          async (input: {
            existingFlags: string[];
            feedbackMemory?: AgentFeedbackMemory;
            userMessage?: string;
            toolCalls: AgentChatResponse['toolCalls'];
          }) =>
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
          feedbackMemory,
          userMessage: message,
          toolCalls
          }
        );
        synthesisDurationMs = Date.now() - synthesizeStartedAt;

        logger.debug('[agent.chat] SYNTHESIZED', {
          answerLength: synthesized.answer.length,
          answerPreview: synthesized.answer.slice(0, 400) + (synthesized.answer.length > 400 ? '...' : ''),
          flags: synthesized.flags,
          synthesisDurationMs,
          toolCallCount: toolCalls.length
        });

        trace.push({
          type: 'llm',
          durationMs: Date.now() - synthesizeStartedAt,
          name: 'synthesize',
          input: { messagePreview: message.slice(0, 200), toolCallCount: toolCalls.length },
          output: { answerPreview: synthesized.answer.slice(0, 500), flags: synthesized.flags }
        });

        // synthesizeToolResults already extracts error messages into the output
        // Just use the synthesized answer which includes the Tool errors section
        let baseAnswer = synthesized.answer;
        const clarification = getPreferredSingleToolAnswerFromToolCalls(toolCalls);
        if (clarification) {
          baseAnswer = clarification;
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
        logger.debug('[agent.chat] FINALIZE_INPUT', {
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
        await persistConversationArtifacts({
          conversationId,
          conversationStore,
          draftCreateOrderParams: latestCreateOrderParams,
          previousState: persistedState,
          response,
          toolCalls
        });
        (response as AgentChatResponse).trace = trace;

        logger.debug('[agent.chat] FINALIZE_OUTPUT', {
          answerLength: response.answer.length,
          answerPreview: response.answer.slice(0, 300) + (response.answer.length > 300 ? '...' : ''),
          verification: response.verification
        });
        logger.debug('[agent.chat] LATENCY', {
          routeDurationMs,
          selectedToolsCount: selectedTools.length,
          synthesisDurationMs,
          toolExecutionDurationMs,
          totalDurationMs: Date.now() - chatStartedAt
        });

        return response as AgentChatResponse;
      } catch (error) {
        const failureAnswer =
          isTimeoutError(error)
            ? timeoutMessageForOperation('tool.batch')
            : 'I could not complete the request because a tool failed. Please retry.';
        const errMsg = isTimeoutError(error)
          ? `agent tool flow timed out after ${AGENT_OPERATION_TIMEOUT_MS / 1000} seconds`
          : error instanceof Error
            ? error.message
            : 'unknown tool failure';
        errors.push({
          code: isTimeoutError(error) ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_FAILED',
          message: errMsg,
          recoverable: isTimeoutError(error) ? true : inferToolRecoverableFromThrownError(error)
        });

        toolCalls.push({
          result: { reason: isTimeoutError(error) ? 'tool_timeout' : 'tool_failure', errorMessage: errMsg },
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
  return message.replace(/^TOOL_EXECUTION_(FAILED|TIMEOUT):\s*/i, '').trim();
}
