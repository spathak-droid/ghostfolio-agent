import { traceable } from 'langsmith/traceable';

import { buildTraceMetadata, buildTraceTags } from './trace-context';
import { validateToolArgs } from '../validation/tool-args-validator';
import { withOperationTimeout } from './operation-timeout';
import {
  AgentTraceContext,
  AgentToolName,
  AgentTools
} from '../types';

// Re-export timeout utilities for external use
export {
  AGENT_OPERATION_TIMEOUT_MS,
  AgentOperationTimeoutError,
  isTimeoutError,
  timeoutMessageForOperation,
  withOperationTimeout
} from './operation-timeout';

// Re-export transaction-dependent flow
export { runTransactionsDependentFlow } from './transaction-dependent-flow';

export { buildTraceMetadata, buildTraceTags, createTraceContext } from './trace-context';
export {
  getReportedToolFailure,
  hasUsableToolData,
  inferToolRecoverableFromThrownError
} from './tool-result-utils';

export async function executeTool({
  conversationHistory,
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
  conversationHistory?: { role: string; content: string }[];
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
      })(runtimeTrace, { conversation_history: conversationHistory, impersonationId, message, range, take, token })
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
