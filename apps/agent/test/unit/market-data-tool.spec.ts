import { marketDataTool } from '../../server/tools/market-data';

describe('marketDataTool', () => {
  it('returns current quote only and ignores historical metrics', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 110,
        symbol: 'AAPL'
      })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'price check',
      metrics: ['price', 'change_percent_1w'],
      symbols: ['AAPL']
    });

    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 0
      })
    );
    expect(result.summary).toContain('Current data for 1 symbol(s)');
    expect(symbols[0]).toEqual(
      expect.objectContaining({
        currency: 'USD',
        currentPrice: 110,
        symbol: 'AAPL'
      })
    );
    expect(symbols[0]?.changePercent1w).toBeUndefined();
  });

  it('computes week-over-week change when message asks for last week', async () => {
    // Use dates relative to a consistent baseline to avoid flakiness
    // Set "today" to be 2026-03-01 and "7 days ago" to be 2026-02-22
    const now = new Date('2026-03-01T12:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 125.5,
        symbol: 'AAPL',
        historicalData: [
          { date: '2026-02-22T00:00:00.000Z', value: 100 },
          { date: '2026-03-01T00:00:00.000Z', value: 125.5 }
        ]
      })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'what is the difference in apple stock compared to last week from today'
    });

    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 10
      })
    );
    expect(symbols[0]?.changePercent1w).toBe(25.5);
    expect(result.answer).toContain('vs 1w: +25.5%');

    (Date.now as jest.Mock).mockRestore();
  });

  it('parses "past 1 week" and "last 1 week" as 7-day window and includes 1w comparison', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 125.5,
        symbol: 'AAPL',
        historicalData: [
          { date: '2026-02-21T00:00:00.000Z', value: 120 },
          { date: '2026-02-26T00:00:00.000Z', value: 125.5 }
        ]
      })
    };

    const resultPast = await marketDataTool({
      client: client as never,
      message: 'how is apple doing past 1 week',
      symbols: ['AAPL']
    });
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 10
      })
    );
    expect((resultPast.symbols as Array<Record<string, unknown>>)[0]?.changePercent1w).toBeDefined();
    expect(resultPast.answer).toMatch(/1w|week/);

    client.getSymbolData.mockClear();
    const resultLast = await marketDataTool({
      client: client as never,
      message: 'how is apple doing last 1 week',
      symbols: ['AAPL']
    });
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 10
      })
    );
    expect((resultLast.symbols as Array<Record<string, unknown>>)[0]?.changePercent1w).toBeDefined();
  });

  it('returns one-year historical comparison when asked for last year', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 67492,
        symbol: 'BTC-USD',
        historicalData: [
          { date: '2025-02-26T00:00:00.000Z', value: 51000 },
          { date: '2026-02-26T00:00:00.000Z', value: 67492 }
        ]
      })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'how much was bitcoin last year ?'
    });

    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 380
      })
    );
    expect(result.answer).toContain('1y ago (2025-02-26): USD 51000');
    expect(result.answer).toContain('vs 1y: +32.34%');
  });

  it('resolves common typo and suffix in natural language query', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 333.12,
        symbol: 'TSLA'
      })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'Quote Telsa stock'
    });

    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: 'YAHOO',
        includeHistoricalData: 0,
        symbol: 'TSLA'
      })
    );
    expect(symbols[0]).toEqual(
      expect.objectContaining({
        currency: 'USD',
        currentPrice: 333.12,
        symbol: 'TSLA'
      })
    );
  });

  it('does not report USD 0 when provider returns missing market price', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({ items: [] }),
      getSymbolData: jest
        .fn()
        .mockResolvedValueOnce({
          currency: 'USD',
          dataSource: 'YAHOO',
          symbol: 'BTC-USD'
        })
        .mockResolvedValueOnce({
          currency: 'USD',
          dataSource: 'COINGECKO',
          symbol: 'bitcoin'
        })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'what is BTC price',
      symbols: ['BTC']
    });

    expect(result.answer).not.toContain('USD 0');
    expect(result.answer).toContain('Missing market price');

    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect((symbols[0]?.error as { message?: string } | undefined)?.message).toContain(
      'Missing market price'
    );
  });
});
