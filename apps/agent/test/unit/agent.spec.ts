import { createAgent } from '../../server/agent';

type CreateAgentOptions = Parameters<typeof createAgent>[0];
type AgentTools = CreateAgentOptions['tools'];

function buildDefaultTools(): AgentTools {
  return {
    complianceCheck: jest.fn(),
    factComplianceCheck: jest.fn(),
    createOrder: jest.fn(),
    factCheck: jest.fn(),
    getOrders: jest.fn(),
    getTransactions: jest.fn(),
    marketData: jest.fn(),
    marketDataLookup: jest.fn(),
    staticAnalysis: jest.fn(),
    holdingsAnalysis: jest.fn().mockResolvedValue({
      allocation: [],
      data_as_of: '2026-02-24T00:00:00Z',
      sources: ['test'],
      summary: 'Holdings analysis from Ghostfolio data'
    }),
    portfolioAnalysis: jest.fn(),
    transactionCategorize: jest.fn(),
    transactionTimeline: jest.fn()
  };
}

function createTestAgent({
  feedbackMemoryProvider,
  llm,
  tools
}: {
  feedbackMemoryProvider?: CreateAgentOptions['feedbackMemoryProvider'];
  llm?: CreateAgentOptions['llm'];
  tools?: Partial<AgentTools>;
}): ReturnType<typeof createAgent> {
  return createAgent({
    feedbackMemoryProvider,
    llm,
    tools: {
      ...buildDefaultTools(),
      ...(tools ?? {})
    }
  });
}

describe('standalone agent orchestrator', () => {
  it('loads feedback memory before synthesis and uses grounded llm synthesis', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'tool_call',
      rationale: 'finance',
      tool: 'market_data_lookup'
    });
    const getForToolSignature = jest.fn().mockResolvedValue({
      do: ['Provide actionable next steps.'],
      dont: ['Avoid generic opening.'],
      sources: 1,
      synthesisIssues: ['Keep synthesis faithful to tool output.'],
      toolIssues: ['market_data_lookup: timeout']
    });
    const agent = createTestAgent({
      feedbackMemoryProvider: {
        getForToolSignature
      },
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery,
        selectTool: jest.fn().mockResolvedValue({
          tool: 'market_data_lookup'
        })
      },
      tools: {
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'AAPL', value: 200 }],
          summary: 'AAPL snapshot',
          sources: ['ghostfolio_api'],
          data_as_of: '2026-02-26T00:00:00.000Z'
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-feedback-memory-1',
      message: 'summarize my portfolio allocation',
      token: 'jwt-token'
    });

    expect(getForToolSignature).toHaveBeenCalledWith(
      'portfolio_analysis>holdings_analysis'
    );
    expect(response.answer).toBe('fallback');
    expect(response.trace?.some((step) => step.name === 'feedback_memory_lookup')).toBe(true);
  });

  it('uses LLM-selected tool when planner is enabled', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn(),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'needs lookup',
          tool: 'market_data_lookup'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'TSLA', value: 211.43 }],
          summary: 'TSLA moved +2.1% on the day'
        }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-llm-1',
      message: 'How is TSLA doing today?',
      token: 'jwt-token'
    });

    expect(response.toolCalls[0]?.toolName).toBe('market_data_lookup');
    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Latest prices: TSLA 211.43.');
  });

  it('uses grounded llm synthesis for focused top performers answer', async () => {
    const answerFinanceQuestion = jest.fn().mockResolvedValue('Top performing coin: SOL-USD (+8.82%).');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'holdings question',
          tool: 'holdings_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        holdingsAnalysis: jest.fn().mockResolvedValue({
          allocation: [
            { percentage: 55, symbol: 'NVDA' },
            { percentage: 45, symbol: 'MSFT' }
          ],
          data_as_of: '2026-02-27T00:00:00.000Z',
          holdings: {
            NVDA: { symbol: 'NVDA', allocationInPercentage: 0.55, netPerformancePercent: 0.184 },
            MSFT: { symbol: 'MSFT', allocationInPercentage: 0.45, netPerformancePercent: 0.091 }
          },
          sources: ['ghostfolio_api'],
          summary: 'Holdings analysis from Ghostfolio data'
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-top-performers-focused-1',
      message: 'what is my top performers?',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(response.answer).toBe('Top performing coin: SOL-USD (+8.82%).');
  });

  it('falls back to deterministic synthesis when focused LLM is unavailable', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockRejectedValue(new Error('llm unavailable')),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'holdings question',
          tool: 'holdings_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        holdingsAnalysis: jest.fn().mockResolvedValue({
          allocation: [
            { percentage: 55, symbol: 'NVDA' },
            { percentage: 45, symbol: 'MSFT' }
          ],
          data_as_of: '2026-02-27T00:00:00.000Z',
          holdings: {
            NVDA: { symbol: 'NVDA', allocationInPercentage: 0.55, netPerformancePercent: 0.184 },
            MSFT: { symbol: 'MSFT', allocationInPercentage: 0.45, netPerformancePercent: 0.091 }
          },
          sources: ['ghostfolio_api'],
          summary: 'Holdings analysis from Ghostfolio data'
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-top-performers-deterministic-1',
      message: 'what are my top performers?',
      token: 'jwt-token'
    });

    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Top performers:');
  });

  it('uses grounded llm synthesis for portfolio performance over time question', async () => {
    const answerFinanceQuestion = jest.fn().mockResolvedValue('Your portfolio peaked on 2026-01-15 at 125000, dropped to 80000 on 2026-02-01, and is now 110000.');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'portfolio trend',
          tool: 'portfolio_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        portfolioAnalysis: jest.fn().mockResolvedValue({
          data_as_of: '2026-02-27T00:00:00.000Z',
          sources: ['ghostfolio_api'],
          summary: 'Portfolio analysis from Ghostfolio data',
          chart: [
            { date: '2026-01-01', netWorth: 100000 },
            { date: '2026-01-15', netWorth: 125000 },
            { date: '2026-02-01', netWorth: 80000 },
            { date: '2026-02-27', netWorth: 110000 }
          ],
          performance: {
            netPerformance: 10000,
            netPerformancePercentage: 0.1
          }
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-performance-over-time-1',
      message: 'How has my portfolio performed over time?',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(response.answer).toContain('peaked on 2026-01-15');
  });

  it('uses grounded llm synthesis for portfolio worth question', async () => {
    const answerFinanceQuestion = jest.fn().mockResolvedValue('Your portfolio is worth 352394.34 USD.');
    const worthPayload = {
      allocation: [
        { percentage: 60, symbol: 'AAPL' },
        { percentage: 40, symbol: 'MSFT' }
      ],
      data_as_of: '2026-02-27T00:00:00.000Z',
      summary: {
        cash: 36470.69,
        totalValueInBaseCurrency: 352394.34
      },
      sources: ['ghostfolio_api']
    };
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'portfolio worth',
          tool: 'holdings_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        holdingsAnalysis: jest.fn().mockResolvedValue(worthPayload),
        portfolioAnalysis: jest.fn().mockResolvedValue(worthPayload)
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-portfolio-worth-1',
      message: 'how is my portfolio worth',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(answerFinanceQuestion.mock.calls[0]?.[0]).toContain(
      'portfolio balance'
    );
    expect(response.answer).toBe('Your portfolio is worth 352394.34 USD.');
  });

  it('routes specific coin/stock/holding questions through holdings_analysis', async () => {
    const analyzeStockTrend = jest.fn().mockResolvedValue({
      summary: 'trend',
      sources: ['ghostfolio_api'],
      data_as_of: '2026-02-27T00:00:00.000Z'
    });
    const holdingsAnalysis = jest.fn().mockResolvedValue({
      holdings: {
        BTCUSD: {
          symbol: 'BTCUSD',
          allocationInPercentage: 0.4,
          netPerformancePercent: 0.07
        }
      },
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Holdings analysis from Ghostfolio data'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('BTCUSD +7%.'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'specific asset trend',
          tool: 'analyze_stock_trend',
          tools: ['analyze_stock_trend']
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        analyzeStockTrend,
        holdingsAnalysis
      }
    });

    await agent.chat({
      conversationId: 'conv-specific-asset-holdings-routing-1',
      message: 'what is my top performing coin?',
      token: 'jwt-token'
    });

    expect(holdingsAnalysis).toHaveBeenCalled();
    expect(analyzeStockTrend).not.toHaveBeenCalled();
  });

  it('uses reasoning agent decision to force direct reply without tools', async () => {
    const marketDataLookup = jest.fn();
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('A finance joke: diversification is not putting all your eggs in one ETF.');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          rationale: 'casual conversational query',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'market_data_lookup'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup,
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-reason-direct-1',
      message: 'tell me a finance joke',
      token: 'jwt-token'
    });

    expect(marketDataLookup).not.toHaveBeenCalled();
    expect(response.toolCalls).toHaveLength(0);
    expect(response.answer.toLowerCase()).toContain('finance joke');
  });

  it('uses reasoning agent decision to execute selected tool', async () => {
    const marketDataLookup = jest.fn().mockResolvedValue({
      prices: [{ symbol: 'AAPL', value: 210.12 }],
      summary: 'AAPL price snapshot.'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn(),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'user asked for latest market data',
          tool: 'market_data_lookup'
        }),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'none'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup,
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-reason-tool-1',
      message: 'what is aapl price',
      token: 'jwt-token'
    });

    expect(marketDataLookup).toHaveBeenCalled();
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'market_data_lookup', success: true })
      ])
    );
  });

  it('answers directly with LLM when no tool is needed', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest
          .fn()
          .mockResolvedValue('Diversification spreads risk across assets.'),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'none'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-llm-2',
      message: 'What is diversification in investing?',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual([]);
    expect(response.answer).toBe('Diversification spreads risk across assets.');
    expect(response.verification.isValid).toBe(true);
  });

  it('returns structured LLM error instead of throwing when direct answer generation fails', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockRejectedValue(new Error('llm unavailable')),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'none'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-llm-failure-direct-1',
      message: 'What is diversification in investing?',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LLM_EXECUTION_FAILED', recoverable: true })
      ])
    );
    expect(response.answer.toLowerCase()).toContain('could not generate');
  });

  it('prioritizes smalltalk/general intent before finance tools', async () => {
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('Hi! I can help with finance questions when you are ready.');
    const marketDataLookup = jest.fn();
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        selectTool: jest.fn().mockResolvedValue({
          tool: 'market_data_lookup'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup,
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-general-smalltalk-1',
      message: 'hello',
      token: 'jwt-token'
    });

    expect(marketDataLookup).not.toHaveBeenCalled();
    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(response.toolCalls).toHaveLength(0);
    expect(response.answer.toLowerCase()).toContain('hi');
  });

  it('skips tools for non-finance prompts without finance entities or actions', async () => {
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('I can chat generally or help with portfolio and transactions.');
    const portfolioAnalysis = jest.fn();
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        selectTool: jest.fn().mockResolvedValue({
          tool: 'portfolio_analysis'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis,
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-general-non-finance-1',
      message: 'tell me a joke',
      token: 'jwt-token'
    });

    expect(portfolioAnalysis).not.toHaveBeenCalled();
    expect(response.toolCalls).toHaveLength(0);
    expect(response.verification.isValid).toBe(true);
  });

  it('falls back to inferred tools when LLM planner returns none for a tool-intent prompt', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('LLM fallback answer'),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'none'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn().mockResolvedValue({
          allocation: [{ percentage: 100, symbol: 'AAPL' }],
          data_as_of: '2026-02-24T10:03:00Z',
          sources: ['ghostfolio_api'],
          summary: 'Concentrated in AAPL'
        }),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-llm-none-fallback-1',
      message: 'Analyze my portfolio allocation',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'portfolio_analysis', success: true })
      ])
    );
    expect(response.answer).toBe('LLM fallback answer');
  });

  it('routes portfolio query to portfolio-analysis tool and uses tool payload in structured response', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn().mockResolvedValue({
          allocation: [
            { percentage: 60, symbol: 'AAPL' },
            { percentage: 40, symbol: 'MSFT' }
          ],
          sources: ['ghostfolio_api'],
          summary: 'Diversified with two large-cap holdings',
          data_as_of: '2026-02-24T10:00:00Z'
        }),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-1',
      message: 'Analyze my portfolio allocation',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'portfolio_analysis' })
      ])
    );
    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Key findings:');
    expect(response.answer).toContain('AAPL');
    expect(response.answer).toContain('MSFT');
    expect(response.answer).toContain('Risks/flags:');
    expect(response.answer).toContain('Actionable next steps:');
    expect(response.verification.isValid).toBe(true);
  });

  it('synthesizes nested tool payload fields from Ghostfolio tool wrapper', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn().mockResolvedValue({
          source: 'ghostfolio_api',
          summary: 'Portfolio analysis from Ghostfolio data',
          data: {
            allocation: [
              { percentage: 55, symbol: 'AAPL' },
              { percentage: 45, symbol: 'MSFT' }
            ],
            data_as_of: '2026-02-24T10:02:00Z',
            sources: ['ghostfolio_api']
          }
        }),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-portfolio-nested-1',
      message: 'Analyze my portfolio allocation',
      token: 'jwt-token'
    });

    expect(response.answer).toContain('AAPL 55%');
    expect(response.answer).toContain('MSFT 45%');
    expect(response.answer).not.toContain('No material findings');
    expect(response.verification.flags).not.toContain('missing_provenance');
    expect(response.verification.isValid).toBe(true);
  });

  it('returns graceful tool failure with recoverable error', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockRejectedValue(new Error('downstream error')),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-2',
      message: 'Get market data for AAPL',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TOOL_EXECUTION_FAILED', recoverable: true })
      ])
    );
    expect(response.answer).toContain('could not complete');
  });

  it('propagates non-retryable tool errors into errors[].recoverable=false', async () => {
    const nonRetryableError = Object.assign(new Error('forbidden'), { retryable: false });
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockRejectedValue(nonRetryableError),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-tool-non-retryable-1',
      message: 'Get market data for AAPL',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TOOL_EXECUTION_FAILED',
          recoverable: false
        })
      ])
    );
  });

  it('treats tool-returned success=false payload as a failed tool call', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          success: false,
          summary: 'Market data lookup failed: Ghostfolio API request failed: 500',
          error: {
            error_code: 'GHOSTFOLIO_HTTP_ERROR',
            message: 'Ghostfolio API request failed: 500',
            retryable: true
          }
        }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-tool-reported-failure-1',
      message: 'Get market data for AAPL',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TOOL_EXECUTION_FAILED',
          message: expect.stringContaining('Ghostfolio API request failed: 500')
        })
      ])
    );
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'market_data_lookup', success: false })
      ])
    );
  });

  it('returns tool-driven error answer when selected tools fail', async () => {
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('I could not fetch live data, but I can still explain what this metric means.');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'needs lookup',
          tool: 'market_data_lookup'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockRejectedValue(new Error('downstream error')),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-tool-fallback-1',
      message: 'what is the latest price of aapl',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).not.toHaveBeenCalled();
    expect(response.answer).toContain('downstream error');
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TOOL_EXECUTION_FAILED', recoverable: true })
      ])
    );
  });

  it('hides raw tool error details for upstream API failures', async () => {
    const answerFinanceQuestion = jest.fn().mockResolvedValue('fallback');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'needs lookup',
          tool: 'market_data_lookup'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest
          .fn()
          .mockRejectedValue(new Error('Ghostfolio API request failed: 500')),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-tool-fallback-api-1',
      message: 'what is the latest price of aapl',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).not.toHaveBeenCalled();
    expect(response.answer).toBe(
      'I could not fetch data from the Ghostfolio API right now. Please retry.'
    );
    expect(response.answer).not.toContain('Ghostfolio API request failed: 500');
  });

  it('falls back to direct LLM answer when tool output is empty', async () => {
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('I did not receive tool data. Please retry or refresh your data source.');
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion,
        selectTool: jest.fn().mockResolvedValue({
          tool: 'market_data_lookup'
        })
      },
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({ summary: '' }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-tool-empty-fallback-1',
      message: 'get market data for aapl',
      token: 'jwt-token'
    });

    expect(answerFinanceQuestion).toHaveBeenCalled();
    expect(response.answer.toLowerCase()).toContain('did not receive tool data');
  });

  it('routes market query to market-data-lookup tool and returns structured response', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'AAPL', value: 192.12 }],
          sources: ['ghostfolio_api'],
          summary: 'AAPL last trade 192.12 USD',
          data_as_of: '2026-02-24T10:01:00Z'
        }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-3',
      message: 'Get market data for AAPL',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'market_data_lookup', success: true })
      ])
    );
    expect(response.answer).toContain('AAPL');
    expect(response.answer).toContain('192.12');
    expect(response.verification.isValid).toBe(true);
  });

  it('does not call analyze_stock_trend for portfolio-wide holdings questions', async () => {
    const analyzeStockTrend = jest.fn().mockResolvedValue({
      answer: 'Trend analysis result',
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Stock trend analysis for BTCUSD'
    });
    const holdingsAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 57.55, symbol: 'BTCUSD' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Holdings analysis from Ghostfolio data'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'trend and holdings requested',
          tools: ['analyze_stock_trend', 'holdings_analysis'],
          tool: 'analyze_stock_trend'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        analyzeStockTrend,
        holdingsAnalysis
      }
    });

    await agent.chat({
      conversationId: 'conv-broad-holdings-trend-1',
      message: 'how are all my holdings doing? any risk ?',
      token: 'jwt-token'
    });

    expect(analyzeStockTrend).not.toHaveBeenCalled();
    expect(holdingsAnalysis).toHaveBeenCalled();
  });

  it('uses only portfolio_analysis when message says portfolio', async () => {
    const portfolioAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 60, symbol: 'AAPL' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Portfolio analysis from Ghostfolio data'
    });
    const holdingsAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 60, symbol: 'AAPL' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Holdings analysis from Ghostfolio data'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'both proposed',
          tools: ['portfolio_analysis', 'holdings_analysis'],
          tool: 'portfolio_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        portfolioAnalysis,
        holdingsAnalysis
      }
    });

    await agent.chat({
      conversationId: 'conv-portfolio-only-1',
      message: 'how is my portfolio doing?',
      token: 'jwt-token'
    });

    expect(portfolioAnalysis).toHaveBeenCalled();
    expect(holdingsAnalysis).not.toHaveBeenCalled();
  });

  it('uses only holdings_analysis when message says holdings', async () => {
    const portfolioAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 60, symbol: 'AAPL' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Portfolio analysis from Ghostfolio data'
    });
    const holdingsAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 60, symbol: 'AAPL' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Holdings analysis from Ghostfolio data'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'both proposed',
          tools: ['portfolio_analysis', 'holdings_analysis'],
          tool: 'holdings_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        portfolioAnalysis,
        holdingsAnalysis
      }
    });

    await agent.chat({
      conversationId: 'conv-holdings-only-1',
      message: 'how are my holdings doing?',
      token: 'jwt-token'
    });

    expect(holdingsAnalysis).toHaveBeenCalled();
    expect(portfolioAnalysis).not.toHaveBeenCalled();
  });

  it('uses both portfolio and holdings analysis for portfolio allocation questions', async () => {
    const portfolioAnalysis = jest.fn().mockResolvedValue({
      allocation: [],
      data_as_of: '2026-02-27T00:00:00.000Z',
      performance: {
        balance: 351101.8,
        portfolio: 351101.8,
        netPerformance: 13521.8,
        netPerformancePercentage: 0.0006
      },
      sources: ['ghostfolio_api'],
      summary: 'Portfolio analysis from Ghostfolio performance data'
    });
    const holdingsAnalysis = jest.fn().mockResolvedValue({
      allocation: [{ percentage: 57.55, symbol: 'BTCUSD' }],
      data_as_of: '2026-02-27T00:00:00.000Z',
      sources: ['ghostfolio_api'],
      summary: 'Holdings analysis from Ghostfolio data'
    });
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'portfolio question',
          tool: 'portfolio_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        portfolioAnalysis,
        holdingsAnalysis
      }
    });

    await agent.chat({
      conversationId: 'conv-portfolio-allocation-holdings-only-1',
      message: 'summarize my portfolio allocation',
      token: 'jwt-token'
    });

    expect(holdingsAnalysis).toHaveBeenCalled();
    expect(portfolioAnalysis).toHaveBeenCalled();
  });

  it('synthesizes multiple tools in one coherent response', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'NVDA', value: 820.55 }],
          sources: ['ghostfolio_api'],
          summary: 'NVDA closed higher on earnings momentum',
          data_as_of: '2026-02-24T10:05:00Z'
        }),
        portfolioAnalysis: jest.fn().mockResolvedValue({
          allocation: [
            { percentage: 72, symbol: 'NVDA' },
            { percentage: 28, symbol: 'MSFT' }
          ],
          sources: ['ghostfolio_api'],
          summary: 'Portfolio is concentrated in NVDA',
          data_as_of: '2026-02-24T10:04:00Z'
        }),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-multi-1',
      message: 'Analyze my portfolio and check latest market data for NVDA',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls.map((call) => call.toolName).sort()).toEqual([
      'market_data_lookup',
      'portfolio_analysis'
    ]);
    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Top allocation: NVDA 72%, MSFT 28%.');
    expect(response.answer).toContain('Latest prices: NVDA 820.55.');
    expect(response.answer).toContain('Risks/flags:');
    expect(response.verification.isValid).toBe(true);
  });

  it('lowers confidence and flags response when tool provenance is missing', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'AAPL', value: 192.12 }],
          summary: 'AAPL last trade 192.12 USD'
        }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-low-confidence-1',
      message: 'Get market data for AAPL',
      token: 'jwt-token'
    });

    expect(response.verification.flags).toContain('missing_provenance');
    expect(response.verification.isValid).toBe(false);
    expect(response.verification.confidence).toBeLessThan(0.5);
    expect(response.answer).toContain('Risks/flags:');
  });

  it('flags response as invalid when fact check reports source mismatch', async () => {
    const agent = createTestAgent({
      tools: {
        marketData: jest.fn().mockResolvedValue({
          symbols: [{ symbol: 'BTCUSD', currency: 'USD', currentPrice: 100000 }],
          summary: 'Market data returned for requested symbols',
          data_as_of: '2026-02-27T00:00:00.000Z',
          sources: ['ghostfolio_api']
        }),
        factCheck: jest.fn().mockResolvedValue({
          comparisons: [
            { symbol: 'BTCUSD', primaryPrice: 100000, secondaryPrice: 103000, match: false }
          ],
          match: false,
          summary: 'Fact check: discrepancy reported.',
          data_as_of: '2026-02-27T00:00:00.000Z',
          sources: ['ghostfolio_api', 'coingecko']
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-fact-check-mismatch-1',
      message: 'what is bitcoin price?',
      token: 'jwt-token'
    });

    expect(response.verification.flags).toContain('fact_check_mismatch');
    expect(response.verification.isValid).toBe(false);
    expect(response.verification.confidence).toBeLessThan(0.5);
  });

  it('returns partial multi-tool synthesis when one tool fails', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'NVDA', value: 820.55 }],
          sources: ['ghostfolio_api'],
          summary: 'NVDA closed higher on earnings momentum',
          data_as_of: '2026-02-24T10:05:00Z'
        }),
        portfolioAnalysis: jest.fn().mockRejectedValue(new Error('portfolio endpoint unavailable')),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-multi-partial-1',
      message: 'Analyze my portfolio and check latest market data for NVDA',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TOOL_EXECUTION_FAILED', recoverable: true })
      ])
    );
    expect(response.toolCalls).toHaveLength(2);
    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Latest prices: NVDA 820.55.');
    expect(response.answer).toContain('Risks/flags:');
    expect(response.verification.flags).toContain('tool_failure');
  });

  it('does not force transaction tool for general chat without matching tool intent', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-generic-1',
      message: 'hello there',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toHaveLength(0);
    expect(response.answer).toContain('I can help with portfolio');
  });

  it('returns clearer auth guidance when all selected tools fail with 401/403', async () => {
    const agent = createTestAgent({
      tools: {
        getTransactions: jest.fn(),
        marketData: jest.fn(),
        marketDataLookup: jest.fn().mockRejectedValue(new Error('Ghostfolio API request failed: 401')),
        portfolioAnalysis: jest.fn().mockRejectedValue(new Error('Ghostfolio API request failed: 403')),
        transactionCategorize: jest.fn(),
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-auth-fail-1',
      message: 'Analyze my portfolio and check market data for NVDA',
      token: undefined
    });

    expect(response.errors.length).toBeGreaterThan(0);
    expect(response.answer.toLowerCase()).toContain('authentication');
    expect(response.answer.toLowerCase()).toContain('sign in');
    expect(response.verification.isValid).toBe(false);
  });

  it('normalizes tool error contract and redacts sensitive text in tool failure responses', async () => {
    const secret = 'token=super-secret-123';
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'portfolio requested',
          tool: 'portfolio_analysis'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        portfolioAnalysis: jest
          .fn()
          .mockRejectedValue(new Error(`Ghostfolio API request failed: 500 ${secret}`))
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-normalized-tool-error-1',
      message: 'Analyze my portfolio performance',
      token: 'jwt-token'
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TOOL_EXECUTION_FAILED'
        })
      ])
    );
    expect(response.errors[0]?.message).not.toContain(secret);
    expect(response.toolCalls[0]?.success).toBe(false);
    expect(response.toolCalls[0]?.result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          error_code: 'TOOL_EXECUTION_FAILED',
          retryable: true
        })
      })
    );
  });

  it('chains get-transactions before transaction-categorize and passes transactions', async () => {
    const getTransactions = jest.fn().mockResolvedValue({
      data: {
        activities: [
          { amount: 100, type: 'BUY' },
          { amount: 50, type: 'SELL' }
        ]
      },
      data_as_of: '2026-02-24T10:06:00Z',
      sources: ['ghostfolio_api'],
      summary: 'Fetched transactions'
    });
    const transactionCategorize = jest.fn().mockResolvedValue({
      categories: [{ category: 'BUY', count: 1 }],
      data_as_of: '2026-02-24T10:06:00Z',
      sources: ['agent_internal'],
      summary: 'Transaction categorization completed'
    });

    const agent = createTestAgent({
      tools: {
        getTransactions,
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn(),
        transactionCategorize,
        transactionTimeline: jest.fn()
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-transactions-chain-1',
      message: 'categorize my transactions',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'get_transactions', success: true }),
        expect.objectContaining({ toolName: 'transaction_categorize', success: true })
      ])
    );
    expect(getTransactions).toHaveBeenCalled();
    expect(transactionCategorize).toHaveBeenCalled();
    expect(response.answer).toContain('Summary: Fetched transactions | Categorized 1 transactions.');
  });

  it('chains get-transactions before transaction-timeline for buy-price questions', async () => {
    const getTransactions = jest.fn().mockResolvedValue({
      data: {
        activities: [
          {
            SymbolProfile: { symbol: 'TSLA' },
            date: '2024-12-24T06:00:00.000Z',
            quantity: 2,
            type: 'BUY',
            unitPrice: 50
          }
        ]
      },
      data_as_of: '2026-02-24T10:06:00Z',
      sources: ['ghostfolio_api'],
      summary: 'Fetched transactions'
    });
    const transactionTimeline = jest.fn().mockResolvedValue({
      data_as_of: '2026-02-24T10:06:00Z',
      sources: ['agent_internal'],
      summary: 'Found 1 matching transaction',
      timeline: [
        {
          date: '2024-12-24',
          quantity: 2,
          symbol: 'TSLA',
          type: 'BUY',
          unitPrice: 50
        }
      ]
    });

    const agent = createTestAgent({
      tools: {
        getTransactions,
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn(),
        transactionTimeline
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-widget-transactions-timeline-1',
      message: 'when did i buy tsla and at what price',
      token: 'jwt-token'
    });

    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'get_transactions', success: true }),
        expect.objectContaining({ toolName: 'transaction_timeline', success: true })
      ])
    );
    expect(response.answer).toContain('TSLA BUY on 2024-12-24 at 50');
  });

  it('returns safe fallback answer when severe output validation fails', async () => {
    const agent = createTestAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('AAPL is 210.12 USD.'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          tool: 'market_data'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools: {
        factCheck: jest.fn().mockResolvedValue({
          answer: 'Fact check: prices match between Ghostfolio and CoinGecko within tolerance.',
          comparisons: [{ match: true, primaryPrice: 210.12, secondaryPrice: 210.1, symbol: 'AAPL' }],
          data_as_of: '2026-02-27T00:00:00.000Z',
          match: true,
          sources: ['ghostfolio_api', 'coingecko'],
          summary: 'Fact check done'
        }),
        marketData: jest.fn().mockResolvedValue({
          data_as_of: '2026-02-27T00:00:00.000Z',
          sources: ['ghostfolio_api'],
          symbols: [{ currentPrice: Number.NaN, symbol: 'AAPL' }]
        })
      }
    });

    const response = await agent.chat({
      conversationId: 'conv-output-validation-severe-1',
      message: 'what is the current price of AAPL?',
      token: 'jwt-token'
    });

    expect(response.answer).toBe(
      'I cannot provide a reliable answer because required validation checks failed. Please retry.'
    );
    expect(response.verification.flags).toContain('VALIDATION_NON_FINITE_NUMBER');
  });
});
