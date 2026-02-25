import { transactionTimelineTool } from '../../server/tools/transaction-timeline';

describe('transactionTimelineTool', () => {
  it('returns BUY timeline entries with date and unit price for requested symbol', async () => {
    const result = await transactionTimelineTool({
      message: 'when did i buy tsla and at what price',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2024-12-24T06:00:00.000Z',
          quantity: 2,
          type: 'BUY',
          unitPrice: 50
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2025-04-03T05:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 399.83
        }
      ]
    });

    expect(result.timeline).toEqual([
      {
        date: '2024-12-24',
        quantity: 2,
        symbol: 'TSLA',
        type: 'BUY',
        unitPrice: 50
      }
    ]);
    expect(result.summary).toContain('1 matching transaction');
    expect(result.sources).toEqual(['agent_internal']);
  });

  it('matches common names like bitcoin when filtering by symbol', async () => {
    const result = await transactionTimelineTool({
      message: 'when did i buy bitcoin and at what price',
      transactions: [
        {
          SymbolProfile: { name: 'Bitcoin USD', symbol: 'BTCUSD' },
          date: '2025-08-17T05:00:00.000Z',
          quantity: 3,
          type: 'BUY',
          unitPrice: 64558.957
        }
      ]
    });

    expect(result.timeline).toEqual([
      {
        date: '2025-08-17',
        quantity: 3,
        symbol: 'BTCUSD',
        type: 'BUY',
        unitPrice: 64558.957
      }
    ]);
  });

  it('returns the most recent transaction for last-transaction intent', async () => {
    const result = await transactionTimelineTool({
      message: 'when was the last transaction i did',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2024-12-24T06:00:00.000Z',
          quantity: 2,
          type: 'BUY',
          unitPrice: 50
        },
        {
          SymbolProfile: { symbol: 'BTCUSD' },
          date: '2025-08-17T05:00:00.000Z',
          quantity: 3,
          type: 'BUY',
          unitPrice: 64558.957
        }
      ]
    });

    expect(result.timeline).toEqual([
      {
        date: '2025-08-17',
        quantity: 3,
        symbol: 'BTCUSD',
        type: 'BUY',
        unitPrice: 64558.957
      }
    ]);
  });

  it('applies explicit structured filters when provided', async () => {
    const result = await transactionTimelineTool({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      message: 'show transactions',
      symbol: 'TSLA',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-01T06:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 400
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2025-12-20T06:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 390
        },
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2026-03-05T06:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 200
        }
      ],
      type: 'SELL'
    });

    expect(result.filters).toEqual(
      expect.objectContaining({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        symbol: 'TSLA',
        type: 'SELL'
      })
    );
    expect(result.timeline).toEqual([
      {
        date: '2026-03-01',
        quantity: 1,
        symbol: 'TSLA',
        type: 'SELL',
        unitPrice: 400
      }
    ]);
  });
});
