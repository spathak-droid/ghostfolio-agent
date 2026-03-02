/**
 * Purpose: Run the agent tool execution phase (loop over selected tools, execute, collect results).
 * Returns either success with latestCreateOrderParams or a failure response when the phase throws.
 */

import type {
  AgentChatResponse,
  AgentConversationMessage,
  AgentLlm,
  AgentTraceContext,
  AgentTraceStep,
  AgentTools,
  CreateOrderParams
} from '../types';
import type { AgentConversationStore, AgentWorkflowState } from '../stores';
import { isTransactionDependentTool } from '../tools/tool-registry';
import { mergeCreateOrderParams, inferCreateOrderParamsFromMessage } from './routing';
import {
  executeTool,
  getReportedToolFailure,
  withOperationTimeout,
  isTimeoutError,
  timeoutMessageForOperation
} from './tool-runtime';
import { runTransactionsDependentFlow } from './transaction-dependent-flow';
import {
  buildToolCallFailureResult,
  sanitizeErrorMessageForClient,
  toOrchestrationErrorEntry
} from '../utils';
import { persistConversationArtifacts } from './workflow-state';
import { buildToolFailureResponse } from './llm-runtime';
import { inferToolRecoverableFromThrownError } from './tool-runtime';
import { logger } from '../utils';

const AGENT_OPERATION_TIMEOUT_MS = 25_000;

export type RunToolExecutionPhaseParams = {
  conversation: AgentConversationMessage[];
  conversationId: string;
  conversationStore: AgentConversationStore;
  dateFrom?: string;
  dateTo?: string;
  errors: AgentChatResponse['errors'];
  impersonationId?: string;
  llm?: AgentLlm;
  llmConversation: AgentConversationMessage[];
  message: string;
  metrics?: string[];
  persistedState?: AgentWorkflowState;
  range?: string;
  requestCreateOrderParams?: CreateOrderParams;
  baseCreateOrderParams?: CreateOrderParams;
  regulations?: string[];
  selectedTools: import('../types').AgentToolName[];
  symbol?: string;
  symbols?: string[];
  take?: number;
  token?: string;
  toolCalls: AgentChatResponse['toolCalls'];
  toolParameters: Record<string, Record<string, unknown> | undefined>;
  tools: AgentTools;
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
  type?: string;
  wantsLatest?: boolean;
};

export type RunToolExecutionPhaseSuccess = {
  kind: 'success';
  latestCreateOrderParams: CreateOrderParams | undefined;
  toolExecutionDurationMs: number;
};

export type RunToolExecutionPhaseFailure = {
  kind: 'failure';
  response: AgentChatResponse;
};

export type RunToolExecutionPhaseResult =
  | RunToolExecutionPhaseSuccess
  | RunToolExecutionPhaseFailure;

export async function runToolExecutionPhase(
  params: RunToolExecutionPhaseParams
): Promise<RunToolExecutionPhaseResult> {
  const {
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
    baseCreateOrderParams,
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
  } = params;

  let latestCreateOrderParams: CreateOrderParams | undefined = baseCreateOrderParams;
  let toolExecutionDurationMs = 0;

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
          let extracted: Partial<CreateOrderParams> | undefined;
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
              extracted as CreateOrderParams,
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

        const llmToolParams = toolParameters[tool] || {};
        const toolSymbols = (llmToolParams.symbols as string[] | undefined) ?? symbols;
        const toolMetrics = (llmToolParams.metrics as string[] | undefined) ?? metrics;
        const toolRange = (llmToolParams.range as string | undefined) ?? range;
        const toolDateFrom = (llmToolParams.dateFrom as string | undefined) ?? dateFrom;
        const toolDateTo = (llmToolParams.dateTo as string | undefined) ?? dateTo;

        const toolStartedAt = Date.now();
        const result = await executeTool({
          conversationHistory: conversation,
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

    return { kind: 'success', latestCreateOrderParams, toolExecutionDurationMs };
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
      selectedToolsCount: selectedTools.length,
      totalDurationMs: 'post-phase'
    });

    return { kind: 'failure', response: failureResponse };
  }
}
