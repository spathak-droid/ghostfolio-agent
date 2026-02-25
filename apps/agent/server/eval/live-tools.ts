import { GhostfolioClient } from '../ghostfolio-client';
import { AgentTools, CreateOrderParams, UpdateOrderParams } from '../types';
import { createOrderTool } from '../tools/create-order';
import { getTransactionsTool } from '../tools/get-transactions';
import { marketDataLookupTool } from '../tools/market-data-lookup';
import { marketDataTool } from '../tools/market-data';
import { marketOverviewTool } from '../tools/market-overview';
import { portfolioAnalysisTool } from '../tools/portfolio-analysis';
import { transactionCategorizeTool } from '../tools/transaction-categorize';
import { transactionTimelineTool } from '../tools/transaction-timeline';
import { updateOrderTool } from '../tools/update-order';

interface RuntimeToolInput {
  impersonationId?: string;
  message: string;
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
  updateOrderParams?: UpdateOrderParams;
}

function resolveToolInput(a: unknown, b?: RuntimeToolInput): RuntimeToolInput {
  if (b && typeof b.message === 'string') return b;
  return a as RuntimeToolInput;
}

export function createLiveEvalTools({
  ghostfolioBaseUrl
}: {
  ghostfolioBaseUrl: string;
}): AgentTools {
  const client = new GhostfolioClient(ghostfolioBaseUrl);

  return {
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
    updateOrder: (a, b) => {
      const { impersonationId, message, token, updateOrderParams } = resolveToolInput(a, b);
      return updateOrderTool({
        impersonationId,
        client,
        message,
        token,
        updateOrderParams
      });
    }
  };
}
