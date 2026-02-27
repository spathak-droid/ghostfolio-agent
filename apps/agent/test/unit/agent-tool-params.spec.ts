import { createAgent } from '../../server/agent';
import { createInMemoryConversationStore } from '../../server/conversation-store';
import type { AgentTools } from '../../server/types';

function createTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    complianceCheck: jest.fn().mockResolvedValue({}),
    createOrder: jest.fn().mockResolvedValue({}),
    createOtherActivities: jest.fn().mockResolvedValue({}),
    factCheck: jest.fn().mockResolvedValue({}),
    getOrders: jest.fn().mockResolvedValue({}),
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
    holdingsAnalysis: jest.fn().mockResolvedValue({}),
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

  it('preserves create_order clarification params across turns', async () => {
    const createOrder = jest
      .fn()
      .mockImplementation((_inputOrRun, input?: { createOrderParams?: Record<string, unknown> }) => {
        const params = input?.createOrderParams ?? {};
        if (!params.symbol || !params.type) {
          return Promise.resolve({
            answer: 'Please provide symbol and type.',
            missingFields: ['symbol', 'type'],
            needsClarification: true,
            success: true
          });
        }
        if (typeof params.quantity !== 'number') {
          return Promise.resolve({
            answer: 'Please provide quantity.',
            missingFields: ['quantity'],
            needsClarification: true,
            success: true
          });
        }
        if (typeof params.currency !== 'string') {
          return Promise.resolve({
            answer: 'Please provide currency.',
            missingFields: ['currency'],
            needsClarification: true,
            success: true
          });
        }
        return Promise.resolve({
          answer: 'Order recorded.',
          success: true
        });
      });

    const getToolParametersForOrder = jest
      .fn()
      .mockResolvedValueOnce({ symbol: 'SOL-USD', type: 'BUY' })
      .mockResolvedValueOnce({ quantity: 50000 })
      .mockResolvedValueOnce({ currency: 'EUR' });

    const tools = createTools({ createOrder });
    const conversationStore = createInMemoryConversationStore();
    const agent = createAgent({
      conversationStore,
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder,
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

    const conversationId = 'conv-agent-tool-params-clarification';
    await agent.chat({
      conversationId,
      message: 'can you buy me solana',
      token: 'jwt-token'
    });
    const stateAfterFirst = await conversationStore.getState(conversationId);
    expect(stateAfterFirst?.draftCreateOrderParams).toEqual(
      expect.objectContaining({ symbol: 'SOL-USD', type: 'BUY' })
    );
    await agent.chat({
      conversationId,
      message: '50,000 shares',
      token: 'jwt-token'
    });
    const stateAfterSecond = await conversationStore.getState(conversationId);
    expect(stateAfterSecond?.draftCreateOrderParams).toEqual(
      expect.objectContaining({ quantity: 50000, symbol: 'SOL-USD', type: 'BUY' })
    );
    await agent.chat({
      conversationId,
      message: 'EUR',
      token: 'jwt-token'
    });

    const thirdCallArgs = createOrder.mock.calls[2]?.[1] as { createOrderParams?: Record<string, unknown> };
    expect(thirdCallArgs.createOrderParams).toEqual(
      expect.objectContaining({
        currency: 'EUR',
        quantity: 50000,
        symbol: 'SOL-USD',
        type: 'BUY'
      })
    );
  });

  it('infers create_order type from explicit sell intent when extractor misses it', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please provide symbol.',
      missingFields: ['symbol'],
      needsClarification: true,
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
      conversationId: 'conv-agent-tool-params-sell-intent',
      message: 'sell my stock',
      token: 'jwt-token'
    });

    const callArgs = createOrder.mock.calls[0]?.[1] as { createOrderParams?: Record<string, unknown> };
    expect(callArgs.createOrderParams).toEqual(
      expect.objectContaining({
        type: 'SELL'
      })
    );
  });

  it('overrides hallucinated solana symbol with deterministic SOL-USD mapping', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please provide quantity.',
      missingFields: ['quantity'],
      needsClarification: true,
      success: true
    });
    const tools = createTools({ createOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest
          .fn()
          .mockResolvedValue({ symbol: 'SOLALAUSD', type: 'BUY' }),
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
      conversationId: 'conv-agent-tool-params-solana-override',
      message: 'buy me solana',
      token: 'jwt-token'
    });

    const callArgs = createOrder.mock.calls[0]?.[1] as { createOrderParams?: Record<string, unknown> };
    expect(callArgs.createOrderParams).toEqual(
      expect.objectContaining({
        symbol: 'SOL-USD',
        type: 'BUY'
      })
    );
  });

  it('keeps pending create_order clarification tool on ambiguous follow-up text', async () => {
    const createOrder = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'Please provide quantity.',
        missingFields: ['quantity'],
        needsClarification: true,
        success: true
      })
      .mockResolvedValueOnce({
        answer: 'Please provide quantity.',
        missingFields: ['quantity'],
        needsClarification: true,
        success: true
      });
    const tools = createTools({ createOrder });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'order execution requested',
        tool: 'create_order'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'ambiguous phrase',
        tool: 'none'
      });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest
          .fn()
          .mockResolvedValueOnce({ symbol: 'SOL-USD', type: 'BUY' })
          .mockResolvedValueOnce(undefined),
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-pending-order';
    await agent.chat({
      conversationId,
      message: 'buy me solana',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: 'no solana USD',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it('does not force pending create_order on unrelated follow-up text', async () => {
    const createOrder = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'How many shares of SOL-USD do you want to buy?',
        missingFields: ['quantity'],
        needsClarification: true,
        success: true
      });
    const tools = createTools({ createOrder });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'order execution requested',
        tool: 'create_order'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'off-topic follow-up',
        tool: 'none'
      });
    const answerFinanceQuestion = jest.fn().mockResolvedValue('Noted. We can continue the order when ready.');
    const agent = createAgent({
      llm: {
        answerFinanceQuestion,
        getToolParametersForOrder: jest
          .fn()
          .mockResolvedValueOnce({ symbol: 'SOL-USD', type: 'BUY' })
          .mockResolvedValueOnce(undefined),
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-offtopic-order';
    await agent.chat({
      conversationId,
      message: 'buy me solana',
      token: 'jwt-token'
    });
    const followUp = await agent.chat({
      conversationId,
      message: 'my name is sandehs',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(followUp.answer).toBe('Noted. We can continue the order when ready.');
  });

  it('prevents replaying create_order on confirmation phrase when no pending order exists', async () => {
    const createOrder = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'Recorded: BUY 2 TSLA at USD 417.4.',
        success: true,
        summary: 'Created BUY order for TSLA'
      });
    const tools = createTools({ createOrder });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'order execution requested',
        tool: 'create_order'
      })
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'follow-up confirmation',
        tool: 'create_order'
      });
    const getToolParametersForOrder = jest
      .fn()
      .mockResolvedValueOnce({ symbol: 'TSLA', type: 'BUY', quantity: 2, currency: 'USD' })
      .mockResolvedValueOnce({ symbol: 'TSLA', type: 'BUY', quantity: 2, currency: 'USD' });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder,
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-no-replay';
    await agent.chat({
      conversationId,
      message: 'buy 2 TSLA in USD',
      token: 'jwt-token'
    });

    const replayAttempt = await agent.chat({
      conversationId,
      message: 'yes proceed',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(replayAttempt.answer).toContain('There is no pending order to confirm');
  });

  it('keeps pending create_order when user responds with DOGEUSD ticker-style symbol', async () => {
    const createOrder = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'Which symbol would you like to trade?',
        missingFields: ['symbol'],
        needsClarification: true,
        success: true
      })
      .mockResolvedValueOnce({
        answer: 'How many shares of DOGEUSD do you want to sell?',
        missingFields: ['quantity'],
        needsClarification: true,
        success: true
      });
    const tools = createTools({ createOrder });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'sell intent',
        tool: 'create_order'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'ticker input only',
        tool: 'none'
      });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest
          .fn()
          .mockResolvedValueOnce({ type: 'SELL' })
          .mockResolvedValueOnce({ symbol: 'DOGEUSD' }),
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-dogeusd';
    await agent.chat({
      conversationId,
      message: 'sell my stock',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: 'DOGEUSD',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalledTimes(2);
    const secondCallArgs = createOrder.mock.calls[1]?.[1] as { createOrderParams?: Record<string, unknown> };
    expect(secondCallArgs.createOrderParams).toEqual(
      expect.objectContaining({
        symbol: 'DOGEUSD',
        type: 'SELL'
      })
    );
  });

  it('infers quantity for explicit execution phrase "buy me 2 tesla stocks"', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Order recorded.',
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
        selectTool: jest.fn().mockResolvedValue({ tool: 'create_order' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-buy-me-2-tsla',
      message: 'buy me 2 tesla stocks',
      token: 'jwt-token'
    });

    const callArgs = createOrder.mock.calls[0]?.[1] as { createOrderParams?: Record<string, unknown> };
    expect(callArgs.createOrderParams).toEqual(
      expect.objectContaining({
        quantity: 2,
        symbol: 'TSLA',
        type: 'BUY'
      })
    );
  });

  it('keeps pending create_other_activities on detail follow-up text', async () => {
    const createOtherActivities = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'Which activity would you like to record? Choose one: DIVIDEND, FEE, INTEREST, LIABILITY.',
        missingFields: ['type'],
        needsClarification: true,
        success: true
      })
      .mockResolvedValueOnce({
        answer: 'What amount should I record for this liability activity?',
        missingFields: ['unitPrice'],
        needsClarification: true,
        success: true
      })
      .mockResolvedValueOnce({
        answer: 'Recorded: LIABILITY MORTGAGE USD 10000.',
        success: true
      });
    const tools = createTools({ createOtherActivities });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'activity creation requested',
        tool: 'create_other_activities'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'short follow-up typo',
        tool: 'none'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'details sentence',
        tool: 'none'
      });
    const getToolParametersForOrder = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ type: 'LIABILITY' })
      .mockResolvedValueOnce({
        date: '2026-02-25',
        symbol: 'MORTGAGE',
        unitPrice: 10000
      });

    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder,
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-other-activity-pending';
    await agent.chat({
      conversationId,
      message: 'add a liability',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: 'liablity',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: 'do name as mortgage, amount to 10,000 and date to today',
      token: 'jwt-token'
    });

    expect(createOtherActivities).toHaveBeenCalledTimes(3);
  });

  it('preserves pending create_other_activities across direct-reply turns and does not drop on confirmation', async () => {
    const createOtherActivities = jest
      .fn()
      .mockResolvedValue({
        answer: 'Which activity would you like to record? Choose one: DIVIDEND, FEE, INTEREST, LIABILITY.',
        missingFields: ['type'],
        needsClarification: true,
        success: true
      });
    const tools = createTools({ createOtherActivities });
    const reasonAboutQuery = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'finance',
        mode: 'tool_call',
        rationale: 'activity creation requested',
        tool: 'create_other_activities'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'typo',
        tool: 'none'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'details',
        tool: 'none'
      })
      .mockResolvedValueOnce({
        intent: 'general',
        mode: 'direct_reply',
        rationale: 'confirmation',
        tool: 'none'
      });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({ type: 'LIABILITY' })
          .mockResolvedValueOnce({ symbol: 'MORTGAGE', unitPrice: 10000 })
          .mockResolvedValueOnce(undefined),
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const conversationId = 'conv-agent-tool-params-other-activity-confirm';
    await agent.chat({
      conversationId,
      message: 'add a liability',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: 'liabilty',
      token: 'jwt-token'
    });
    await agent.chat({
      conversationId,
      message: "add mortgae of 10000 and today's date",
      token: 'jwt-token'
    });
    const confirmResponse = await agent.chat({
      conversationId,
      message: 'yes',
      token: 'jwt-token'
    });

    expect(createOtherActivities).toHaveBeenCalledTimes(4);
    expect(confirmResponse.answer).not.toContain('There is no pending order to confirm');
  });

  it('routes typo liability command to create_other_activities (not create_order)', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Order recorded.',
      success: true
    });
    const createOtherActivities = jest.fn().mockResolvedValue({
      answer: 'Which symbol should this activity be recorded for?',
      missingFields: ['symbol'],
      needsClarification: true,
      success: true
    });
    const tools = createTools({ createOrder, createOtherActivities });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest.fn().mockResolvedValue(undefined),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          rationale: 'ambiguous',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-typo-liability-route',
      message: 'buy me a liabilty',
      token: 'jwt-token'
    });

    expect(createOtherActivities).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('prioritizes execution tools over portfolio analysis for explicit liability add intent', async () => {
    const portfolioAnalysis = jest.fn().mockResolvedValue({
      summary: 'Portfolio summary'
    });
    const createOtherActivities = jest.fn().mockResolvedValue({
      answer: 'Which symbol should this activity be recorded for?',
      missingFields: ['symbol'],
      needsClarification: true,
      success: true
    });
    const tools = createTools({ createOtherActivities, portfolioAnalysis });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest.fn().mockResolvedValue({ type: 'LIABILITY' }),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'mixed intent',
          tools: ['portfolio_analysis', 'create_other_activities']
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'portfolio_analysis' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-liability-priority',
      message: 'yes add a liability in my portfolio',
      token: 'jwt-token'
    });

    expect(createOtherActivities).toHaveBeenCalledTimes(1);
    expect(portfolioAnalysis).not.toHaveBeenCalled();
  });

  it('routes typo dividend command to create_other_activities (not LLM direct)', async () => {
    const createOtherActivities = jest.fn().mockResolvedValue({
      answer: 'What amount should I record for this dividend activity?',
      missingFields: ['unitPrice'],
      needsClarification: true,
      success: true
    });
    const tools = createTools({ createOtherActivities });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        getToolParametersForOrder: jest.fn().mockResolvedValue({ type: 'DIVIDEND' }),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          rationale: 'typo',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-agent-tool-params-typo-dividend-route',
      message: 'add a divident',
      token: 'jwt-token'
    });

    expect(createOtherActivities).toHaveBeenCalledTimes(1);
  });

  it('returns a timeout message when direct LLM answer exceeds 25 seconds', async () => {
    jest.useFakeTimers();
    try {
      const tools = createTools();
      const agent = createAgent({
        llm: {
          answerFinanceQuestion: jest.fn().mockImplementation(
            () => new Promise<string>(() => undefined)
          ),
          reasonAboutQuery: jest.fn().mockResolvedValue({
            intent: 'general',
            mode: 'direct_reply',
            tool: 'none'
          }),
          selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
        },
        tools
      });

      const chatPromise = agent.chat({
        conversationId: 'conv-agent-timeout-direct-llm',
        message: 'hello',
        token: 'jwt-token'
      });
      await jest.advanceTimersByTimeAsync(25_001);
      const response = await chatPromise;

      expect(response.answer).toContain('25 seconds');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns a timeout message when a selected tool exceeds 25 seconds', async () => {
    jest.useFakeTimers();
    try {
      const portfolioAnalysis = jest.fn().mockImplementation(
        () => new Promise<Record<string, unknown>>(() => undefined)
      );
      const tools = createTools({ portfolioAnalysis });
      const agent = createAgent({
        llm: {
          answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
          reasonAboutQuery: jest.fn().mockResolvedValue({
            intent: 'finance',
            mode: 'tool_call',
            rationale: 'portfolio requested',
            tool: 'portfolio_analysis'
          }),
          selectTool: jest.fn().mockResolvedValue({ tool: 'portfolio_analysis' })
        },
        tools
      });

      const chatPromise = agent.chat({
        conversationId: 'conv-agent-timeout-tool',
        message: 'analyze my portfolio',
        token: 'jwt-token'
      });
      await jest.advanceTimersByTimeAsync(25_001);
      const response = await chatPromise;

      expect(response.answer).toContain('25 seconds');
      expect(response.errors.some((error) => error.code === 'TOOL_EXECUTION_TIMEOUT')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
