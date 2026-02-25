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

  it('keeps current-only behavior even when message asks for last week', async () => {
    const client = {
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 125.5,
        symbol: 'AAPL'
      })
    };

    const result = await marketDataTool({
      client: client as never,
      message: 'what is the difference in apple stock compared to last week from today'
    });

    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect(client.getSymbolData).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHistoricalData: 0
      })
    );
    expect(symbols[0]?.changePercent1w).toBeUndefined();
    expect(result.summary).toContain('Current data for 1 symbol(s)');
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
    expect(symbols[0]?.error).toContain('Missing market price');
  });
});
