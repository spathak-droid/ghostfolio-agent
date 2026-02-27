import { createAgent } from '../../server/agent';

type CreateAgentOptions = Parameters<typeof createAgent>[0];
type AgentTools = CreateAgentOptions['tools'];

function buildDefaultTools(): AgentTools {
  return {
    complianceCheck: jest.fn(),
    createOrder: jest.fn(),
    factCheck: jest.fn(),
    getOrders: jest.fn(),
    getTransactions: jest.fn(),
    marketData: jest.fn(),
    marketDataLookup: jest.fn(),
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
  it('loads feedback memory before synthesis and skips extra llm synthesis call', async () => {
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
      'market_data_lookup>portfolio_analysis>holdings_analysis'
    );
    expect(response.answer).toContain(
      'Set explicit target allocation bands for each major position and cash.'
    );
    expect(response.trace?.some((step) => step.name === 'feedback_memory_synthesis')).toBe(true);
    expect(response.trace?.some((step) => step.name === 'llm_synthesize_from_tool_results')).toBe(
      false
    );
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
    expect(response.answer).toContain('Summary:');
    expect(response.answer).toContain('Top allocation: AAPL 100%.');
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

  it('uses only holdings_analysis for portfolio allocation questions', async () => {
    const portfolioAnalysis = jest.fn().mockResolvedValue({
      allocation: [],
      data_as_of: '2026-02-27T00:00:00.000Z',
      performance: {
        currentNetWorth: 351101.8,
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
    expect(portfolioAnalysis).not.toHaveBeenCalled();
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
});
