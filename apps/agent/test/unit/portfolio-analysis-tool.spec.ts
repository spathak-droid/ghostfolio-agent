import { portfolioAnalysisTool } from '../../server/tools/portfolio-analysis';

describe('portfolioAnalysisTool', () => {
  it('returns normalized performance details from Ghostfolio performance payload', async () => {
    const client = {
      getPortfolioPerformance: jest.fn().mockResolvedValue({
        chart: [{ date: '2026-02-25', netWorth: 300000 }],
        firstOrderDate: '2024-06-05T00:00:00.000Z',
        performance: {
          currentNetWorth: 351563.41169516824,
          currentValueInBaseCurrency: 314684.14626796823,
          netPerformance: 13983.427745622115,
          netPerformancePercentage: 0.0009682222506529307
        }
      })
    };

    const result = await portfolioAnalysisTool({
      client: client as never,
      message: 'Analyze my portfolio performance'
    });

    expect(result.summary).toBe('Portfolio analysis from Ghostfolio performance data');
    expect(result.performance).toEqual({
      currentNetWorth: 351563.41169516824,
      netPerformance: 13983.427745622115,
      netPerformancePercentage: 0.0009682222506529307,
      totalValueInBaseCurrency: 314684.14626796823
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(result.data).toEqual(
      expect.objectContaining({
        firstOrderDate: '2024-06-05T00:00:00.000Z'
      })
    );
    expect(typeof result.data_as_of).toBe('string');
  });
});
