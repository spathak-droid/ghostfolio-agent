import { analyzeStockTrendTool } from '../../server/tools/analyze-stock-trend';

describe('analyzeStockTrendTool', () => {
  it('analyzes BTC trend and computes period change from holding history', async () => {
    const client = {
      getPortfolioHolding: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          SymbolProfile: { name: 'Bitcoin USD', symbol: 'BTCUSD' },
          averagePrice: 63273.535,
          dataSource: 'YAHOO',
          historicalData: [
            { date: '2026-02-20', marketPrice: 68005.42, quantity: 3 },
            { date: '2026-02-21', marketPrice: 68003.76, quantity: 3 },
            { date: '2026-02-22', marketPrice: 67659.39, quantity: 3 },
            { date: '2026-02-23', marketPrice: 64616.74, quantity: 3 },
            { date: '2026-02-24', marketPrice: 64080.04, quantity: 3 },
            { date: '2026-02-25', marketPrice: 64080.04, quantity: 3 },
            { date: '2026-02-26', marketPrice: 67549.55, quantity: 3 }
          ],
          marketPrice: 67549.55,
          marketPriceMax: 124752.53,
          marketPriceMin: 62702.1,
          netPerformance: 12728.05,
          netPerformancePercent: 0.0670530209,
          quantity: 3
        }),
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] })
    };

    const result = await analyzeStockTrendTool({
      client: client as never,
      message: 'how is my bitcoin doing',
      range: '7d'
    });

    expect(client.getPortfolioHolding).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ dataSource: 'YAHOO', symbol: 'BTC-USD' })
    );
    expect(client.getPortfolioHolding).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ dataSource: 'YAHOO', symbol: 'BTCUSD' })
    );
    expect(result.summary).toContain('Stock trend analysis for BTCUSD');
    expect(result.answer).toContain('BTCUSD');
    expect(result.answer).toContain('Timeline: 7d');
    expect(result.answer).toContain('Period change');
    expect(result.answer).toContain('Since entry');
    expect(result.sources).toEqual(['ghostfolio_api']);
    expect(result).toEqual(
      expect.objectContaining({
        chart: expect.objectContaining({
          points: expect.arrayContaining([
            expect.objectContaining({ date: '2026-02-20', price: 68005.42 }),
            expect.objectContaining({ date: '2026-02-26', price: 67549.55 })
          ])
        }),
        performance: expect.objectContaining({
          currentPrice: expect.any(Number),
          periodChange: expect.any(Number),
          periodChangePercent: expect.any(Number),
          sinceEntryChange: expect.any(Number),
          sinceEntryChangePercent: expect.any(Number)
        })
      })
    );
  });

  it('returns a clarification response when symbol cannot be resolved', async () => {
    const client = {
      getPortfolioHolding: jest.fn(),
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] })
    };

    const result = await analyzeStockTrendTool({
      client: client as never,
      message: 'how is my mooncoin doing',
      range: '1m'
    });

    expect(result.success).toBe(false);
    expect(result.answer).toContain('I could not resolve which asset');
    expect(result.summary).toContain('Stock trend analysis failed');
  });

  it('filters out common English words like "how" to avoid false symbol matches', async () => {
    const client = {
      getPortfolioHolding: jest.fn().mockResolvedValue({
        SymbolProfile: { name: 'Bitcoin USD', symbol: 'BTCUSD' },
        averagePrice: 63000,
        dataSource: 'YAHOO',
        historicalData: [
          { date: '2026-02-20', marketPrice: 65000, quantity: 1 },
          { date: '2026-02-26', marketPrice: 67000, quantity: 1 }
        ],
        marketPrice: 67000,
        quantity: 1
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] })
    };

    const result = await analyzeStockTrendTool({
      client: client as never,
      message: 'how is my bitcoin doing',
      range: '7d'
    });

    // Should resolve "bitcoin" as a prioritized asset (via alias), not call lookup for "how"
    expect(client.getSymbolLookup).not.toHaveBeenCalled();
    expect(result.answer).toContain('Bitcoin USD');
  });

  it('returns no-holdings guidance when portfolio has no holdings', async () => {
    const client = {
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: { USD: { symbol: 'USD', allocationInPercentage: 1 } }
      }),
      getPortfolioHolding: jest.fn(),
      getSymbolLookup: jest.fn()
    };

    const result = await analyzeStockTrendTool({
      client: client as never,
      message: 'how is my holding doing'
    });

    expect(result.success).toBe(false);
    expect(result.answer).toContain('portfolio has no holdings yet');
    expect(client.getSymbolLookup).not.toHaveBeenCalled();
    expect(client.getPortfolioHolding).not.toHaveBeenCalled();
  });
});
