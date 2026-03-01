/**
 * Agent factory: Creates agent instances with tool registrations.
 * Handles dependency injection and tool parameter normalization.
 */

import { createAgent } from './agent';
import { createUserScopedConversationStore, withToolResponseCache } from './stores';
import { GhostfolioClient } from './clients';
import { toolInput } from './tools/tool-input';
import { analyzeStockTrendTool } from './tools/analyze-stock-trend';
import { complianceCheckTool } from './tools/compliance-check';
import { createOrderTool } from './tools/create-order';
import { createOtherActivitiesTool } from './tools/create-other-activities';
import { factCheckTool } from './tools/fact-check';
import { factComplianceCheckTool } from './tools/fact-compliance-check';
import { getOrdersTool } from './tools/get-orders';
import { getTransactionsTool } from './tools/get-transactions';
import { holdingsAnalysisTool } from './tools/holdings-analysis';
import { marketDataLookupTool } from './tools/market-data-lookup';
import { marketDataTool } from './tools/market-data';
import { marketOverviewTool } from './tools/market-overview';
import { portfolioAnalysisTool } from './tools/portfolio-analysis';
import { portfolioSummaryTool } from './tools/portfolio-summary';
import { staticAnalysisTool } from './tools/static-analysis';
import { taxEstimateTool } from './tools/tax-estimate';
import { transactionCategorizeTool } from './tools/transaction-categorize';
import { transactionTimelineTool } from './tools/transaction-timeline';
import type { ServerConfig } from './server-config';

export function createAgentWithClient(
  config: ServerConfig,
  ghostfolioClient: GhostfolioClient,
  storeScopeId: string
) {
  const store = createUserScopedConversationStore(config.conversationStore, storeScopeId);
  return createAgent({
    contextManager: config.contextManager,
    conversationStore: store,
    ...(config.enableFeedbackMemory ? { feedbackMemoryProvider: config.feedbackStore } : {}),
    llm: config.llm,
    tools: {
      getTransactions: (a, b) => {
        const { impersonationId, message, range, take, token } = toolInput(a, b);
        return getTransactionsTool({
          client: ghostfolioClient,
          impersonationId,
          message,
          range,
          take,
          token
        });
      },
      complianceCheck: (a, b) => {
        const { message, createOrderParams, regulations } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { message, createOrderParams, regulations },
          task: () =>
            complianceCheckTool({
              createOrderParams,
              llmFactExtractor: config.llm?.extractComplianceFacts,
              message,
              regulations
            }),
          toolName: 'compliance_check',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      factCheck: (a, b) => {
        const { impersonationId, message, symbols, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, symbols, token },
          task: () =>
            factCheckTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              symbols,
              token
            }),
          toolName: 'fact_check',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      factComplianceCheck: (a, b) => {
        const {
          createOrderParams,
          impersonationId,
          message,
          regulations,
          symbols,
          token,
          type
        } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: {
            createOrderParams,
            impersonationId,
            message,
            regulations,
            symbols,
            token,
            type
          },
          task: () =>
            factComplianceCheckTool({
              client: ghostfolioClient,
              createOrderParams,
              impersonationId,
              llmFactExtractor: config.llm?.extractComplianceFacts,
              message,
              regulationStore: config.regulationStore,
              regulations,
              symbols,
              token,
              type
            }),
          toolName: 'fact_compliance_check',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      marketData: (a, b) => {
        const { impersonationId, message, metrics, symbols, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, metrics, symbols, token },
          task: () =>
            marketDataTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              metrics,
              symbols,
              token
            }),
          toolName: 'market_data',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      analyzeStockTrend: (a, b) => {
        const { impersonationId, message, range, symbol, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, range, symbol, token },
          task: () =>
            analyzeStockTrendTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              range,
              symbol,
              token
            }),
          toolName: 'analyze_stock_trend',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      marketDataLookup: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            marketDataLookupTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'market_data_lookup',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      marketOverview: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            marketOverviewTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'market_overview',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      portfolioSummary: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            portfolioSummaryTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'portfolio_summary',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      portfolioAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            portfolioAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'portfolio_analysis',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      holdingsAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            holdingsAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'holdings_analysis',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      staticAnalysis: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, token },
          task: () =>
            staticAnalysisTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              token
            }),
          toolName: 'static_analysis',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      taxEstimate: (a, b) => {
        const { impersonationId, message, range, take, token } = toolInput(a, b);
        return withToolResponseCache({
          cache: config.toolResponseCache,
          input: { impersonationId, message, range, take, token },
          task: () =>
            taxEstimateTool({
              client: ghostfolioClient,
              impersonationId,
              message,
              range,
              take,
              token
            }),
          toolName: 'tax_estimate',
          ttlMs: config.toolResponseCacheTtlMs
        });
      },
      transactionCategorize: (a, b) => {
        const {
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type
        } = toolInput(a, b);
        return transactionCategorizeTool({
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type
        });
      },
      transactionTimeline: (a, b) => {
        const {
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type,
          wantsLatest
        } = toolInput(a, b);
        return transactionTimelineTool({
          dateFrom,
          dateTo,
          impersonationId,
          message,
          symbol,
          token,
          transactions,
          type,
          wantsLatest
        });
      },
      createOrder: (a, b) => {
        const { impersonationId, message, token, createOrderParams } = toolInput(a, b);
        return createOrderTool({
          client: ghostfolioClient,
          impersonationId,
          message,
          token,
          createOrderParams
        });
      },
      createOtherActivities: (a, b) => {
        const { impersonationId, message, token, createOrderParams } = toolInput(a, b);
        return createOtherActivitiesTool({
          client: ghostfolioClient,
          impersonationId,
          message,
          token,
          createOrderParams
        });
      },
      getOrders: (a, b) => {
        const { impersonationId, message, token } = toolInput(a, b);
        return getOrdersTool({
          client: ghostfolioClient,
          impersonationId,
          message,
          token
        });
      }
    }
  });
}
