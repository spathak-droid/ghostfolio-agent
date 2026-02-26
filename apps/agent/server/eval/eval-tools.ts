import {
  AgentLlm,
  AgentToolInput,
  AgentToolName,
  AgentTools
} from '../types';
import { ToolCapture, LlmTrace } from './eval-types';

export function createEvalTools(captures: ToolCapture[]): AgentTools {
  const track = (tool: AgentToolName, inputOrRun: AgentToolInput, input?: AgentToolInput) => {
    const value = resolveInput(inputOrRun, input);
    captures.push({ input: value as unknown as Record<string, unknown>, tool });
    return value;
  };

  return {
    complianceCheck: async (inputOrRun, input) => {
      track('compliance_check', inputOrRun, input);
      return buildResult({
        answer: 'Compliance check passed for available rules.',
        isCompliant: true,
        policyVersion: 'us-baseline-v1',
        summary: 'Compliance check completed with 0 violation(s) and 0 warning(s).',
        violations: [],
        warnings: []
      });
    },
    createOrder: async (inputOrRun, input) => {
      const resolved = track('create_order', inputOrRun, input);
      const qty = resolved.createOrderParams?.quantity;
      if (qty === undefined) {
        return buildResult({
          answer: 'How many shares do you want to buy?',
          needsClarification: true,
          summary: 'Quantity required'
        });
      }

      return buildResult({
        answer: `Created BUY order for ${qty} shares.`,
        needsClarification: false,
        summary: 'Order created'
      });
    },
    getTransactions: async (inputOrRun, input) => {
      track('get_transactions', inputOrRun, input);
      return buildResult({
        data: {
          activities: [
            {
              SymbolProfile: { name: 'Tesla, Inc.', symbol: 'TSLA' },
              date: '2026-02-01T06:00:00.000Z',
              quantity: 2,
              type: 'BUY',
              unitPrice: 399.83
            }
          ]
        },
        summary: 'Fetched 1 transactions from Ghostfolio',
        transactions: [
          {
            SymbolProfile: { name: 'Tesla, Inc.', symbol: 'TSLA' },
            date: '2026-02-01T06:00:00.000Z',
            quantity: 2,
            type: 'BUY',
            unitPrice: 399.83
          }
        ]
      });
    },
    marketData: async (inputOrRun, input) => {
      track('market_data', inputOrRun, input);
      return buildResult({
        summary: 'Market data returned for requested symbols',
        symbols: [{ currentPrice: 123.45, symbol: 'BTCUSD' }]
      });
    },
    marketDataLookup: async (inputOrRun, input) => {
      track('market_data_lookup', inputOrRun, input);
      return buildResult({
        prices: [{ symbol: 'AAPL', value: 210.12 }],
        summary: 'Market data lookup from Ghostfolio API'
      });
    },
    marketOverview: async (inputOrRun, input) => {
      track('market_overview', inputOrRun, input);
      return buildResult({
        answer: 'Market sentiment snapshot: stocks are greed (66); crypto is fear (38).',
        overview: {
          cryptocurrencies: { label: 'fear', value: 38 },
          stocks: { label: 'greed', value: 66 }
        },
        summary: 'Market overview from Ghostfolio fear & greed index'
      });
    },
    portfolioAnalysis: async (inputOrRun, input) => {
      track('portfolio_analysis', inputOrRun, input);
      return buildResult({
        allocation: [{ percentage: 60, symbol: 'AAPL' }],
        summary: 'Portfolio analysis from Ghostfolio data'
      });
    },
    transactionCategorize: async (inputOrRun, input) => {
      const resolved = track('transaction_categorize', inputOrRun, input);
      return buildResult({
        categories: [{ category: 'BUY', count: (resolved.transactions ?? []).length }],
        summary: 'Transaction categorization completed'
      });
    },
    transactionTimeline: async (inputOrRun, input) => {
      const resolved = track('transaction_timeline', inputOrRun, input);
      const match = resolved.transactions?.[0] as
        | { SymbolProfile?: { symbol?: string }; date?: string; type?: string; unitPrice?: number }
        | undefined;
      return buildResult({
        summary: 'Found 1 matching transactions',
        timeline: [
          {
            date: match?.date?.slice(0, 10) ?? 'unknown',
            symbol: match?.SymbolProfile?.symbol ?? 'TSLA',
            type: match?.type ?? 'BUY',
            unitPrice: match?.unitPrice ?? 399.83
          }
        ]
      });
    },
    getOrders: async (inputOrRun, input) => {
      track('get_orders', inputOrRun, input);
      const msg = (resolveInput(inputOrRun, input).message ?? '').toLowerCase().trim();
      const symbol = !msg ? 'TSLA' : msg === 'doge' ? 'DOGE' : 'AAPL';
      if (!msg || msg === 'apple' || msg === 'tsla' || msg === 'aapl' || msg === 'doge') {
        return buildResult({
          success: true,
          orders: [
            { id: 'eval-order-1', symbol, type: 'BUY', date: '2026-02-01', quantity: 2, unitPrice: 150 }
          ],
          count: 1,
          answer: `I found 1 order: BUY ${symbol} on 2026-02-01 (id: eval-order-1). What do you want to update?`,
          summary: 'Found 1 order(s)'
        });
      }
      return buildResult({
        success: true,
        orders: [],
        count: 0,
        answer: `I didn't find any orders for "${msg || 'that'}". Try another symbol or name, or check your activities list.`,
        summary: msg ? `No orders found for "${msg}"` : 'No orders found'
      });
    }
  };
}

export function createTrackedTools(baseTools: AgentTools, captures: ToolCapture[]): AgentTools {
  const track = (tool: AgentToolName, inputOrRun: AgentToolInput, input?: AgentToolInput) => {
    captures.push({ input: resolveInput(inputOrRun, input) as unknown as Record<string, unknown>, tool });
  };
  const marketOverview = baseTools.marketOverview;

  return {
    complianceCheck: async (inputOrRun, input) => {
      track('compliance_check', inputOrRun, input);
      return baseTools.complianceCheck(inputOrRun, input);
    },
    createOrder: async (inputOrRun, input) => {
      track('create_order', inputOrRun, input);
      return baseTools.createOrder(inputOrRun, input);
    },
    getOrders: async (inputOrRun, input) => {
      track('get_orders', inputOrRun, input);
      return baseTools.getOrders(inputOrRun, input);
    },
    getTransactions: async (inputOrRun, input) => {
      track('get_transactions', inputOrRun, input);
      return baseTools.getTransactions(inputOrRun, input);
    },
    marketData: async (inputOrRun, input) => {
      track('market_data', inputOrRun, input);
      return baseTools.marketData(inputOrRun, input);
    },
    marketDataLookup: async (inputOrRun, input) => {
      track('market_data_lookup', inputOrRun, input);
      return baseTools.marketDataLookup(inputOrRun, input);
    },
    marketOverview: marketOverview
      ? async (inputOrRun, input) => {
          track('market_overview', inputOrRun, input);
          return marketOverview(inputOrRun, input);
        }
      : undefined,
    portfolioAnalysis: async (inputOrRun, input) => {
      track('portfolio_analysis', inputOrRun, input);
      return baseTools.portfolioAnalysis(inputOrRun, input);
    },
    transactionCategorize: async (inputOrRun, input) => {
      track('transaction_categorize', inputOrRun, input);
      return baseTools.transactionCategorize(inputOrRun, input);
    },
    transactionTimeline: async (inputOrRun, input) => {
      track('transaction_timeline', inputOrRun, input);
      return baseTools.transactionTimeline(inputOrRun, input);
    }
  };
}

export function createEvalLlm(trace: LlmTrace): AgentLlm {
  return {
    answerFinanceQuestion: async (message: string) => {
      trace.answerCalls += 1;
      const normalized = message.toLowerCase();
      if (normalized.includes('hello')) {
        return 'Hi. I can help with portfolio, transactions, and market-data questions.';
      }
      if (normalized.includes('joke')) {
        return 'Finance joke: I tried to beat the market, but my fees beat me first.';
      }
      return 'I can help with portfolio, market data, and transaction questions.';
    },
    reasonAboutQuery: async (message: string) => {
      trace.reasoningCalls += 1;
      const normalized = message.toLowerCase();
      if (
        normalized.includes('hello') ||
        normalized.includes('joke') ||
        normalized.includes('what should i do now')
      ) {
        return { intent: 'general', mode: 'direct_reply', tool: 'none' };
      }
      return { intent: 'finance', mode: 'tool_call', tool: 'none' };
    },
    selectTool: async () => ({ tool: 'none' }),
    synthesizeFromToolResults: async (...args) => {
      const [, , toolSummary] = args;
      trace.synthesisCalls += 1;
      return toolSummary;
    }
  };
}

function resolveInput(inputOrRun: AgentToolInput, input?: AgentToolInput): AgentToolInput {
  if (input && typeof input.message === 'string') {
    return input;
  }

  return inputOrRun;
}

function buildResult(partial: Record<string, unknown>) {
  return {
    data_as_of: '2026-02-24T00:00:00Z',
    sources: ['eval_fixture'],
    ...partial
  };
}
