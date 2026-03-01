import { portfolioSummaryTool } from '../../server/tools/portfolio-summary';

describe('portfolioSummaryTool', () => {
  it('returns normalized summary data from Ghostfolio details payload', async () => {
    const client = {
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'account-1': { name: 'Main', balance: 5000, currency: 'USD', valueInBaseCurrency: 5000 }
        },
        platforms: {
          'platform-1': { name: 'Broker', balance: 5000, currency: 'USD', valueInBaseCurrency: 5000 }
        },
        holdings: {
          AAPL: { symbol: 'AAPL', valueInBaseCurrency: 5000, investment: 4500 },
          USD: { symbol: 'USD', valueInBaseCurrency: 5000, investment: 5000 }
        },
        summary: {
          currentNetWorth: 10000,
          currentValueInBaseCurrency: 10000,
          netPerformance: 500,
          netPerformancePercentage: 0.05,
          annualizedPerformancePercent: 0.07,
          totalInvestment: 9500,
          cash: 5000,
          dividendInBaseCurrency: 100,
          fees: 25
        },
        createdAt: '2026-02-26T00:00:00.000Z'
      })
    };

    const result = await portfolioSummaryTool({
      client: client as never,
      message: 'How is my portfolio doing?'
    });

    expect(result.summary).toBe('Portfolio summary from Ghostfolio');
    expect(result.summary_data).toEqual({
      balance: 10000,
      netPerformance: 500,
      netPerformancePercentage: 0.05,
      annualizedPerformancePercent: 0.07,
      portfolio: 10000,
      totalInvestment: 9500,
      cash: 5000,
      dividend: 100,
      fees: 25
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(typeof result.data_as_of).toBe('string');
    expect(result.accounts).toBeDefined();
    expect(result.platforms).toBeDefined();
  });

  it('handles missing optional summary fields gracefully', async () => {
    const client = {
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {},
        platforms: {},
        holdings: {},
        summary: {
          currentNetWorth: 5000,
          currentValueInBaseCurrency: 5000,
          netPerformance: 0,
          netPerformancePercentage: 0
        },
        createdAt: '2026-02-26T00:00:00.000Z'
      })
    };

    const result = await portfolioSummaryTool({
      client: client as never,
      message: 'Portfolio summary'
    });

    expect(result.summary_data).toEqual({
      balance: 5000,
      netPerformance: 0,
      netPerformancePercentage: 0,
      annualizedPerformancePercent: 0,
      portfolio: 5000,
      totalInvestment: 0,
      cash: 0,
      dividend: 0,
      fees: 0
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
  });
});
