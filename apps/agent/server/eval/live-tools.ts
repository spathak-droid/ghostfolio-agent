import { GhostfolioClient } from '../clients';
import { AgentLlm, AgentTools, CreateOrderParams } from '../types';
import { createOrderTool } from '../tools/create-order';
import { getOrdersTool } from '../tools/get-orders';
import { getTransactionsTool } from '../tools/get-transactions';
import { complianceCheckTool } from '../tools/compliance-check';
import { factCheckTool } from '../tools/fact-check';
import { factComplianceCheckTool } from '../tools/fact-compliance-check';
import { marketDataLookupTool } from '../tools/market-data-lookup';
import { marketDataTool } from '../tools/market-data';
import { marketOverviewTool } from '../tools/market-overview';
import { holdingsAnalysisTool } from '../tools/holdings-analysis';
import { portfolioAnalysisTool } from '../tools/portfolio-analysis';
import { staticAnalysisTool } from '../tools/static-analysis';
import { transactionCategorizeTool } from '../tools/transaction-categorize';
import { transactionTimelineTool } from '../tools/transaction-timeline';

interface RuntimeToolInput {
  impersonationId?: string;
  message: string;
  regulations?: string[];
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  token?: string;
  transactions?: Record<string, unknown>[];
  type?: string;
  wantsLatest?: boolean;
  createOrderParams?: CreateOrderParams;
}

function resolveToolInput(a: unknown, b?: RuntimeToolInput): RuntimeToolInput {
  if (b && typeof b.message === 'string') return b;
  return a as RuntimeToolInput;
}

export function createLiveEvalTools({
  ghostfolioBaseUrl,
  llm
}: {
  ghostfolioBaseUrl: string;
  llm?: AgentLlm;
}): AgentTools {
  const client = new GhostfolioClient(ghostfolioBaseUrl);

  return {
    complianceCheck: (a, b) => {
      const { message, createOrderParams, regulations } = resolveToolInput(a, b);
      return complianceCheckTool({
        createOrderParams,
        llmFactExtractor: llm?.extractComplianceFacts,
        message,
        regulations
      });
    },
    factCheck: (a, b) => {
      const { impersonationId, message, symbols, token } = resolveToolInput(a, b);
      return factCheckTool({
        client,
        impersonationId,
        message,
        symbols,
        token
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
      } = resolveToolInput(a, b);
      return factComplianceCheckTool({
        client,
        createOrderParams,
        impersonationId,
        llmFactExtractor: llm?.extractComplianceFacts,
        message,
        regulations,
        symbols,
        token,
        type
      });
    },
    createOrder: (a, b) => {
      const { impersonationId, message, token, createOrderParams } = resolveToolInput(a, b);
      return createOrderTool({
        client,
        impersonationId,
        message,
        token,
        createOrderParams
      });
    },
    getTransactions: (a, b) => {
      const { impersonationId, message, range, take, token } = resolveToolInput(a, b);
      return getTransactionsTool({
        client,
        impersonationId,
        message,
        range,
        take,
        token
      });
    },
    marketData: (a, b) => {
      const { impersonationId, message, metrics, symbols, token } = resolveToolInput(a, b);
      return marketDataTool({
        client,
        impersonationId,
        message,
        metrics,
        symbols,
        token
      });
    },
    marketDataLookup: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return marketDataLookupTool({
        client,
        impersonationId,
        message,
        token
      });
    },
    staticAnalysis: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return staticAnalysisTool({
        client,
        impersonationId,
        message,
        token
      });
    },
    marketOverview: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return marketOverviewTool({
        client,
        impersonationId,
        message,
        token
      });
    },
    portfolioAnalysis: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return portfolioAnalysisTool({
        client,
        impersonationId,
        message,
        token
      });
    },
    holdingsAnalysis: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return holdingsAnalysisTool({
        client,
        impersonationId,
        message,
        token
      });
    },
    transactionCategorize: (a, b) => {
      const { dateFrom, dateTo, impersonationId, message, symbol, token, transactions, type } = resolveToolInput(a, b);
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
      const { dateFrom, dateTo, impersonationId, message, symbol, token, transactions, type, wantsLatest } = resolveToolInput(a, b);
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
    getOrders: (a, b) => {
      const { impersonationId, message, token } = resolveToolInput(a, b);
      return getOrdersTool({
        client,
        impersonationId,
        message,
        token
      });
    }
  };
}
