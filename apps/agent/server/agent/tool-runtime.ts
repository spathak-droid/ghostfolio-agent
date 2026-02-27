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
  toOrchestrationErrorEntry
} from '../utils';
import {
  AgentChatResponse,
  AgentTraceContext,
  AgentTraceStep,
  AgentToolName,
  AgentTools
} from '../types';
import { TRANSACTION_DEPENDENT_TOOL_NAMES } from '../tools/tool-registry';
import { validateToolArgs } from '../validation/tool-args-validator';
import { logger } from '../utils';

export const AGENT_OPERATION_TIMEOUT_MS = 25_000;

class AgentOperationTimeoutError extends Error {
  code: 'AGENT_OPERATION_TIMEOUT';
  operation: string;
  timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'AgentOperationTimeoutError';
    this.code = 'AGENT_OPERATION_TIMEOUT';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutError(error: unknown): error is AgentOperationTimeoutError {
  const code = Boolean(error) && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  const name = Boolean(error) && typeof error === 'object' ? (error as { name?: string }).name : undefined;
  return (
    error instanceof AgentOperationTimeoutError ||
    code === 'AGENT_OPERATION_TIMEOUT' ||
    code === 'OPENAI_TIMEOUT' ||
    name === 'AbortError'
  );
}

export function timeoutMessageForOperation(operation: string) {
  if (operation.startsWith('tool.')) {
    return 'I could not complete this request because a tool timed out after 25 seconds. Please retry.';
  }
  return 'I could not complete this request because the language model timed out after 25 seconds. Please retry.';
}

export async function withOperationTimeout<T>({
  operation,
  task,
  timeoutMs = AGENT_OPERATION_TIMEOUT_MS
}: {
  operation: string;
  task: () => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AgentOperationTimeoutError(operation, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export { buildTraceMetadata, buildTraceTags, createTraceContext } from './trace-context';
export {
  getReportedToolFailure,
  hasUsableToolData,
  inferToolRecoverableFromThrownError
} from './tool-result-utils';

export async function executeTool({
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
  traceContext,
  token,
  tool,
  tools,
  type,
  wantsLatest,
  createOrderParams
}: {
  dateFrom?: string;
  dateTo?: string;
  impersonationId?: string;
  metrics?: string[];
  message: string;
  regulations?: string[];
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
  createOrderParams?: import('../types').CreateOrderParams;
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
  const runToolWithTimeout = <T>(task: () => Promise<T>) =>
    withOperationTimeout({
      operation: `tool.${tool}`,
      task
    });

  const toolArgsValidation = validateToolArgs(tool, {
    dateFrom,
    dateTo,
    range,
    regulations,
    symbol,
    symbols,
    take
  });
  if (!toolArgsValidation.ok) {
    const validationError =
      'error' in toolArgsValidation
        ? toolArgsValidation.error
        : 'Tool argument validation failed.';
    return Promise.resolve({
      success: false,
      error: {
        error_code: 'TOOL_ARGUMENT_VALIDATION_FAILED',
        message: validationError,
        retryable: false
      },
      summary: validationError
    });
  }

  if (tool === 'portfolio_analysis') {
    return runToolWithTimeout(() =>
      traceable(tools.portfolioAnalysis, {
        name: `tool.portfolio_analysis.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'holdings_analysis') {
    return runToolWithTimeout(() =>
      traceable(tools.holdingsAnalysis, {
        name: `tool.holdings_analysis.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'static_analysis') {
    return runToolWithTimeout(() =>
      traceable(tools.staticAnalysis, {
        name: `tool.static_analysis.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'tax_estimate') {
    if (!tools.taxEstimate) {
      return Promise.resolve({
        success: false,
        error: {
          error_code: 'TOOL_NOT_CONFIGURED',
          message: 'tax_estimate tool is not configured',
          retryable: false
        },
        summary: 'Tax estimate tool is not configured.'
      });
    }
    return runToolWithTimeout(() =>
      traceable(tools.taxEstimate, {
        name: `tool.tax_estimate.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, range, take, token })
    );
  }

  if (tool === 'market_data') {
    return runToolWithTimeout(() =>
      traceable(tools.marketData, {
        name: `tool.market_data.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, metrics, symbols, token })
    );
  }

  if (tool === 'analyze_stock_trend') {
    if (!tools.analyzeStockTrend) {
      return runToolWithTimeout(() =>
        traceable(tools.marketData, {
          name: `tool.market_data.turn_${traceContext.turnId}`,
          run_type: 'tool'
        })(runtimeTrace, { impersonationId, message, range, symbol, token })
      );
    }
    return runToolWithTimeout(() =>
      traceable(tools.analyzeStockTrend, {
        name: `tool.analyze_stock_trend.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, range, symbol, token })
    );
  }

  if (tool === 'market_data_lookup') {
    return runToolWithTimeout(() =>
      traceable(tools.marketDataLookup, {
        name: `tool.market_data_lookup.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'market_overview') {
    if (tools.marketOverview) {
      const marketOverviewTool = tools.marketOverview;
      return runToolWithTimeout(() =>
        traceable(marketOverviewTool, {
          name: `tool.market_overview.turn_${traceContext.turnId}`,
          run_type: 'tool'
        })(runtimeTrace, { impersonationId, message, token })
      );
    }
    return runToolWithTimeout(() =>
      traceable(tools.marketDataLookup, {
        name: `tool.market_data_lookup.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'compliance_check') {
    return runToolWithTimeout(() =>
      traceable(tools.complianceCheck, {
        name: `tool.compliance_check.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token, regulations, createOrderParams, type })
    );
  }

  if (tool === 'fact_compliance_check') {
    return runToolWithTimeout(() =>
      traceable(tools.factComplianceCheck, {
        name: `tool.fact_compliance_check.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token, symbols, regulations, createOrderParams, type })
    );
  }

  if (tool === 'get_transactions') {
    return runToolWithTimeout(() =>
      traceable(tools.getTransactions, {
        name: `tool.get_transactions.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, range, take, token })
    );
  }

  if (tool === 'transaction_timeline') {
    return runToolWithTimeout(() =>
      traceable(tools.transactionTimeline, {
        name: `tool.transaction_timeline.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, {
        dateFrom,
        dateTo,
        impersonationId,
        message,
        symbol,
        token,
        type,
        wantsLatest
      })
    );
  }

  if (tool === 'create_order') {
    return runToolWithTimeout(() =>
      traceable(tools.createOrder, {
        name: `tool.create_order.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token, createOrderParams })
    );
  }

  if (tool === 'create_other_activities') {
    if (tools.createOtherActivities) {
      const createOtherActivitiesTool = tools.createOtherActivities;
      return runToolWithTimeout(() =>
        traceable(createOtherActivitiesTool, {
          name: `tool.create_other_activities.turn_${traceContext.turnId}`,
          run_type: 'tool'
        })(runtimeTrace, { impersonationId, message, token, createOrderParams })
      );
    }
    return runToolWithTimeout(() =>
      traceable(tools.createOrder, {
        name: `tool.create_order.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token, createOrderParams })
    );
  }

  if (tool === 'get_orders') {
    return runToolWithTimeout(() =>
      traceable(tools.getOrders, {
        name: `tool.get_orders.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, token })
    );
  }

  if (tool === 'fact_check') {
    if (!tools.factCheck) {
      return runToolWithTimeout(() =>
        traceable(tools.marketData, {
          name: `tool.market_data.turn_${traceContext.turnId}`,
          run_type: 'tool'
        })(runtimeTrace, { impersonationId, message, symbols, token })
      );
    }
    return runToolWithTimeout(() =>
      traceable(tools.factCheck, {
        name: `tool.fact_check.turn_${traceContext.turnId}`,
        run_type: 'tool'
      })(runtimeTrace, { impersonationId, message, symbols, token })
    );
  }

  return runToolWithTimeout(() =>
    traceable(tools.transactionCategorize, {
      name: `tool.transaction_categorize.turn_${traceContext.turnId}`,
      run_type: 'tool'
    })(runtimeTrace, { dateFrom, dateTo, impersonationId, message, symbol, token, type })
  );
}

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
