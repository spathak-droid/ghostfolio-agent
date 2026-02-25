import { createAgent } from '../../server/agent';
import type { AgentTools } from '../../server/types';

function createTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    createOrder: jest.fn().mockResolvedValue({}),
    getTransactions: jest.fn().mockResolvedValue({
      data: {
        activities: [
          {
            SymbolProfile: { symbol: 'TSLA' },
            date: '2026-03-01T00:00:00.000Z',
            quantity: 1,
            type: 'SELL',
            unitPrice: 400
          }
        ]
      },
      summary: 'Fetched 1 transactions',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-01T00:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 400
        }
      ]
    }),
    marketData: jest.fn().mockResolvedValue({}),
    marketDataLookup: jest.fn().mockResolvedValue({}),
    portfolioAnalysis: jest.fn().mockResolvedValue({}),
    transactionCategorize: jest.fn().mockResolvedValue({}),
    transactionTimeline: jest.fn().mockResolvedValue({
      summary: 'Found 1 matching transaction',
      timeline: [
        {
          date: '2026-03-01',
          quantity: 1,
          symbol: 'TSLA',
          type: 'SELL',
          unitPrice: 400
        }
      ]
    }),
    updateOrder: jest.fn().mockResolvedValue({}),
    ...overrides
  };
}

describe('agent tool params plumbing', () => {
  it('passes structured transaction filters to transaction_timeline flow', async () => {
    const transactionTimeline = jest.fn().mockResolvedValue({
      summary: 'Found 1 matching transaction',
      timeline: [
        {
          date: '2026-03-01',
          quantity: 1,
          symbol: 'TSLA',
          type: 'SELL',
          unitPrice: 400
        }
      ]
    });
    const tools = createTools({ transactionTimeline });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn(),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'timeline requested',
          tool: 'transaction_timeline'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      message: 'show my sells',
      symbol: 'TSLA',
      token: 'jwt-token',
      type: 'SELL',
      wantsLatest: false
    });

    expect(transactionTimeline).toHaveBeenCalled();
    const callArgs = transactionTimeline.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).toEqual(
      expect.objectContaining({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        symbol: 'TSLA',
        type: 'SELL',
        wantsLatest: false
      })
    );
  });

  it('passes structured symbols and metrics to market_data', async () => {
    const marketData = jest.fn().mockResolvedValue({
      summary: 'Market data returned for requested symbols',
      symbols: [{ currentPrice: 210.12, symbol: 'AAPL' }]
    });
    const tools = createTools({ marketData });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn(),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'market data requested',
          tool: 'market_data'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-2',
      message: 'price check',
      metrics: ['price', 'change_percent_1w'],
      symbols: ['AAPL'],
      token: 'jwt-token'
    });

    expect(marketData).toHaveBeenCalled();
    const callArgs = marketData.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).toEqual(
      expect.objectContaining({
        metrics: ['price', 'change_percent_1w'],
        symbols: ['AAPL']
      })
    );
  });

  it('passes request-level createOrderParams to create_order when provided', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'order created',
      success: true
    });
    const tools = createTools({ createOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest.fn().mockResolvedValue(undefined),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'order execution requested',
          tool: 'create_order'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-3',
      createOrderParams: {
        quantity: 2,
        symbol: 'AAPL',
        type: 'BUY',
        unitPrice: 200
      },
      message: 'buy 2 aapl',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalled();
    const callArgs = createOrder.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).toEqual(
      expect.objectContaining({
        createOrderParams: {
          quantity: 2,
          symbol: 'AAPL',
          type: 'BUY',
          unitPrice: 200
        }
      })
    );
  });

  it('passes request-level updateOrderParams to update_order when provided', async () => {
    const updateOrder = jest.fn().mockResolvedValue({
      answer: 'order updated',
      success: true
    });
    const tools = createTools({ updateOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest.fn().mockResolvedValue(undefined),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'order update requested',
          tool: 'update_order'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-4',
      message: 'update order abc123 quantity to 3',
      token: 'jwt-token',
      updateOrderParams: {
        orderId: 'abc123',
        quantity: 3
      }
    });

    expect(updateOrder).toHaveBeenCalled();
    const callArgs = updateOrder.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).toEqual(
      expect.objectContaining({
        updateOrderParams: {
          orderId: 'abc123',
          quantity: 3
        }
      })
    );
  });
});
