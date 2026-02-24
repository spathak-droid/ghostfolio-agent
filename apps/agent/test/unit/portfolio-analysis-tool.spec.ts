import { portfolioAnalysisTool } from '../../server/tools/portfolio-analysis';

describe('portfolioAnalysisTool', () => {
  it('returns normalized allocation and performance details from Ghostfolio payload', async () => {
    const client = {
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          USD: { symbol: 'USD', allocationInPercentage: 0.8, valueInBaseCurrency: 800 },
          BTCUSD: { symbol: 'BTCUSD', allocationInPercentage: 0.2, valueInBaseCurrency: 200 }
        },
        summary: {
          netPerformance: 1234.56,
          netPerformancePercentage: 0.101,
          totalValueInBaseCurrency: 10000
        }
      })
    };

    const result = await portfolioAnalysisTool({
      client: client as never,
      message: 'Analyze my portfolio'
    });

    expect(result.summary).toBe('Portfolio analysis from Ghostfolio data');
    expect(result.allocation).toEqual([
      { percentage: 80, symbol: 'USD' },
      { percentage: 20, symbol: 'BTCUSD' }
    ]);
    expect(result.performance).toEqual({
      netPerformance: 1234.56,
      netPerformancePercentage: 0.101,
      totalValueInBaseCurrency: 10000
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(typeof result.data_as_of).toBe('string');
  });
});
