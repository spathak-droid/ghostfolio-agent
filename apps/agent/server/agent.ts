import { traceable } from 'langsmith/traceable';
import {
  AgentLlm,
  AgentChatRequest,
  AgentChatResponse,
  AgentConversationMessage,
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
  llm,
  tools
}: {
  contextManager?: AgentContextManager;
  conversationStore?: AgentConversationStore;
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
      const llmConversation = contextManager.buildContext({
        conversation,
        state: persistedState
      });
      const traceContext = createTraceContext({ conversationId, conversation, message });

      logger.debug('[agent.chat] START', {
        conversationId,
        message,
        conversationLength: conversation.length
      });

      const errors: AgentChatResponse['errors'] = [];
      const toolCalls: AgentChatResponse['toolCalls'] = [];
      const trace: AgentTraceStep[] = [];

      const routeDecision = await decideRoute({
        conversation: llmConversation,
        llm,
        message,
        traceContext
      });
      const selectedTools = preventOrderReplayWithoutPending({
        message,
        pendingState: persistedState,
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
      });
      const intent = routeDecision.intent;

      logger.debug('[agent.chat] ROUTE', {
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

      if (selectedTools.length === 0) {
        return handleNoToolRoute({
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
      }

      let latestCreateOrderParams: import('./types').CreateOrderParams | undefined =
        baseCreateOrderParams;
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
            let createOrderParams = latestCreateOrderParams;
            if (
              (tool === 'create_order' || tool === 'create_other_activities') &&
              llm?.getToolParametersForOrder
            ) {
              let extracted: Partial<import('./types').CreateOrderParams> | undefined;
              try {
                const getToolParametersForOrder = llm.getToolParametersForOrder;
                if (getToolParametersForOrder) {
                  extracted = await withOperationTimeout({
                    operation: 'llm.get_tool_parameters_for_order',
                    task: () =>
                      getToolParametersForOrder(message, llmConversation, tool, traceContext)
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
                result: { reason: 'tool_failure' },
                success: false,
                toolName: tool
              });
              trace.push({
                type: 'tool',
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
              result: { reason: isTimeout ? 'tool_timeout' : 'tool_failure' },
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
            return timeoutResponse;
          }
          if (llm) {
          return finalizeDirectResponse({
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
          return failureResponse;
        }

        if (!hasUsableToolData(toolCalls) && llm) {
          return finalizeDirectResponse({
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

        logger.debug('[agent.chat] SYNTHESIZED', {
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
        const clarification = getPreferredSingleToolAnswerFromToolCalls(toolCalls);
        if (clarification) {
          baseAnswer = clarification;
        } else if (llm?.synthesizeFromToolResults) {
            try {
              const synthesizeFromToolResults = llm.synthesizeFromToolResults;
              if (synthesizeFromToolResults) {
                const llmAnswer = await withOperationTimeout({
                  operation: 'llm.synthesize_from_tool_results',
                  task: () =>
                    synthesizeFromToolResults(message, llmConversation, synthesized.answer, traceContext)
                });
                if (typeof llmAnswer === 'string' && llmAnswer.trim().length > 0) {
                  baseAnswer = llmAnswer.trim();
                }
              }
            } catch (error) {
              if (isTimeoutError(error)) {
                errors.push({
                  code: 'LLM_EXECUTION_TIMEOUT',
                  message: 'llm.synthesize_from_tool_results timed out after 25 seconds',
                  recoverable: true
                });
              } else {
                errors.push({
                  code: 'LLM_EXECUTION_FAILED',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'llm.synthesize_from_tool_results failed',
                  recoverable: true
                });
              }
              baseAnswer = synthesized.answer;
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
          result: { reason: isTimeoutError(error) ? 'tool_timeout' : 'tool_failure' },
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

        return failureResponse;
      }
    },
    { name: 'agent.chat', run_type: 'chain' }
  );

  return {
    chat: tracedChat
  };
}
