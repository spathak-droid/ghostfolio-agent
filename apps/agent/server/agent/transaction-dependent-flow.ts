/**
 * Transaction-dependent flow: Executes tools that depend on transaction data.
 * Orchestrates get_transactions followed by transaction_timeline or transaction_categorize.
 */

import { traceable } from 'langsmith/traceable';

import { buildTraceMetadata, buildTraceTags } from './trace-context';
import {
  extractTransactions,
  getReportedToolFailure,
  inferToolRecoverableFromThrownError
} from './tool-result-utils';
import {
  buildToolCallFailureResult,
  sanitizeErrorMessageForClient,
  toOrchestrationErrorEntry,
  logger
} from '../utils';
import {
  AgentChatResponse,
  AgentTraceContext,
  AgentTraceStep,
  AgentTools
} from '../types';
import { TRANSACTION_DEPENDENT_TOOL_NAMES } from '../tools/tool-registry';
import { isTimeoutError, withOperationTimeout } from './operation-timeout';
import { executeTool } from './tool-runtime';

export async function runTransactionsDependentFlow({
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
    const transactionFlowFailure = getReportedToolFailure(transactionResult);
    if (transactionFlowFailure) {
      const normalizedMessage = sanitizeErrorMessageForClient(transactionFlowFailure.message);
      const entry = toOrchestrationErrorEntry({
        isTimeout: false,
        message: normalizedMessage,
        recoverable: transactionFlowFailure.recoverable
      });
      errors.push(entry);
      toolCalls.push({
        result: buildToolCallFailureResult({
          errorCode: entry.code,
          message: entry.message,
          reason: 'tool_failure',
          retryable: entry.recoverable
        }),
        success: false,
        toolName: 'get_transactions'
      });
      trace.push({
        type: 'tool',
        name: 'get_transactions',
        input: { messagePreview: message.slice(0, 200) },
        output: { reason: 'tool_failure', error: normalizedMessage }
      });
    } else {
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
      logger.debug('[agent.chat] TOOL_RESULT (transaction flow)', {
        tool: 'get_transactions',
        success: true,
        transactionCount: Array.isArray(transactions) ? transactions.length : 0,
        resultPreview:
          typeof transactionResult === 'object' && transactionResult !== null
            ? JSON.stringify(transactionResult).slice(0, 400) + '...'
            : String(transactionResult)
      });
    }
  } catch (error) {
    const isTimedOut = isTimeoutError(error);
    const rawErrorMessage = isTimedOut
      ? 'get_transactions timed out after 25 seconds'
      : error instanceof Error
        ? error.message
        : 'failed to fetch transactions';
    const normalizedMessage = sanitizeErrorMessageForClient(
      rawErrorMessage,
      'failed to fetch transactions'
    );
    const entry = toOrchestrationErrorEntry({
      isTimeout: isTimedOut,
      message: normalizedMessage,
      recoverable: isTimedOut ? true : inferToolRecoverableFromThrownError(error)
    });
    errors.push(entry);
    toolCalls.push({
      result: buildToolCallFailureResult({
        errorCode: entry.code,
        message: entry.message,
        reason: isTimedOut ? 'tool_timeout' : 'tool_failure',
        retryable: entry.recoverable
      }),
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

    const result = await withOperationTimeout({
      operation: step,
      task: () =>
        traceable(toolHandler, {
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
        )
    });
    const dependentFailure = getReportedToolFailure(result);
    if (dependentFailure) {
      const normalizedMessage = sanitizeErrorMessageForClient(dependentFailure.message);
      const entry = toOrchestrationErrorEntry({
        isTimeout: false,
        message: normalizedMessage,
        recoverable: dependentFailure.recoverable
      });
      errors.push(entry);
      toolCalls.push({
        result: buildToolCallFailureResult({
          errorCode: entry.code,
          message: entry.message,
          reason: 'tool_failure',
          retryable: entry.recoverable
        }),
        success: false,
        toolName: dependentTool
      });
      trace.push({
        type: 'tool',
        name: dependentTool,
        input: { messagePreview: message.slice(0, 200) },
        output: { reason: 'tool_failure', error: normalizedMessage }
      });
      return;
    }

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
    logger.debug('[agent.chat] TOOL_RESULT (transaction flow)', {
      tool: dependentTool,
      success: true,
      resultKeys: typeof result === 'object' && result !== null ? Object.keys(result as object) : [],
      resultPreview:
        typeof result === 'object' && result !== null
          ? JSON.stringify(result).slice(0, 500) + (JSON.stringify(result).length > 500 ? '...' : '')
          : String(result)
    });
  } catch (error) {
    const isTimedOut = isTimeoutError(error);
    const rawErrorMessage = isTimedOut
      ? `${dependentTool} timed out after 25 seconds`
      : error instanceof Error
        ? error.message
        : 'unknown tool failure';
    const normalizedMessage = sanitizeErrorMessageForClient(rawErrorMessage);
    const entry = toOrchestrationErrorEntry({
      isTimeout: isTimedOut,
      message: normalizedMessage,
      recoverable: isTimedOut ? true : inferToolRecoverableFromThrownError(error)
    });
    errors.push(entry);
    toolCalls.push({
      result: buildToolCallFailureResult({
        errorCode: entry.code,
        message: entry.message,
        reason: isTimedOut ? 'tool_timeout' : 'tool_failure',
        retryable: entry.recoverable
      }),
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
