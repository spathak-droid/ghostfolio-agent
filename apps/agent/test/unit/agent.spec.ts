import { createAgent } from '../../server/agent';

describe('standalone agent orchestrator', () => {
  it('routes portfolio query to portfolio-analysis tool and returns structured response', async () => {
    const agent = createAgent({
      tools: {
        marketDataLookup: jest.fn(),
        portfolioAnalysis: jest.fn().mockResolvedValue({
          allocation: [
            { percentage: 60, symbol: 'AAPL' },
            { percentage: 40, symbol: 'MSFT' }
          ],
          summary: 'Diversified'
        }),
        transactionCategorize: jest.fn()
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
    expect(response.verification.isValid).toBe(true);
    expect(response.answer).toContain('Portfolio analysis');
  });

  it('returns graceful tool failure with recoverable error', async () => {
    const agent = createAgent({
      tools: {
        marketDataLookup: jest.fn().mockRejectedValue(new Error('downstream error')),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn()
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

  it('routes market query to market-data-lookup tool and returns structured response', async () => {
    const agent = createAgent({
      tools: {
        marketDataLookup: jest.fn().mockResolvedValue({
          prices: [{ symbol: 'AAPL', value: 192.12 }],
          summary: 'Market data lookup from Ghostfolio API'
        }),
        portfolioAnalysis: jest.fn(),
        transactionCategorize: jest.fn()
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
    expect(response.answer).toContain('Market data lookup');
    expect(response.verification.isValid).toBe(true);
  });
});
