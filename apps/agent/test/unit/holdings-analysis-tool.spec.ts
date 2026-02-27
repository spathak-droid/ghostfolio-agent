import { holdingsAnalysisTool } from '../../server/tools/holdings-analysis';

describe('holdingsAnalysisTool', () => {
  it('returns normalized allocation and performance details from Ghostfolio holdings payload', async () => {
    const client = {
      getPortfolioHoldings: jest.fn().mockResolvedValue({
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

    const result = await holdingsAnalysisTool({
      client: client as never,
      message: 'Analyze my holdings'
    });

    expect(result.summary).toBe('Holdings analysis from Ghostfolio data');
    expect(result.allocation).toEqual([{ percentage: 20, symbol: 'BTCUSD' }]);
    expect(result.usd_removed_from_holdings).toBe(true);
    expect(result.performance).toEqual({
      netPerformance: 1234.56,
      netPerformancePercentage: 0.101,
      totalValueInBaseCurrency: 10000
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(typeof result.data_as_of).toBe('string');
  });

  it('normalizes holdings array payload from /portfolio/holdings endpoint', async () => {
    const client = {
      getPortfolioHoldings: jest.fn().mockResolvedValue({
        holdings: [
          {
            allocationInPercentage: 0.6,
            investment: 6000,
            netPerformance: 1200,
            netPerformancePercent: 0.12,
            symbol: 'BTCUSD',
            valueInBaseCurrency: 6000
          },
          {
            allocationInPercentage: 0.3,
            investment: 3000,
            netPerformance: 300,
            netPerformancePercent: 0.1,
            symbol: 'TSLA',
            valueInBaseCurrency: 3000
          },
          {
            allocationInPercentage: 0.1,
            investment: 1000,
            netPerformance: 0,
            netPerformancePercent: 0,
            symbol: 'USD',
            valueInBaseCurrency: 1000
          }
        ]
      })
    };

    const result = await holdingsAnalysisTool({
      client: client as never,
      message: 'Analyze my portfolio allocation'
    });

    expect(result.summary).toBe('Holdings analysis from Ghostfolio data');
    expect(result.allocation).toEqual([
      { percentage: 60, symbol: 'BTCUSD' },
      { percentage: 30, symbol: 'TSLA' }
    ]);
    expect(result.usd_removed_from_holdings).toBe(true);
    expect(result.performance).toEqual({
      netPerformance: 1500,
      netPerformancePercentage: 0.15,
      totalValueInBaseCurrency: 10000
    });
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(typeof result.data_as_of).toBe('string');
  });
});
