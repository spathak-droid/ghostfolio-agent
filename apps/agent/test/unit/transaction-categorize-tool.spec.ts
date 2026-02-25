import { transactionCategorizeTool } from '../../server/tools/transaction-categorize';

describe('transactionCategorizeTool', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-01T00:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates transaction categories with counts and totals', async () => {
    const result = await transactionCategorizeTool({
      message: 'categorize my transactions',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2024-12-24T06:00:00.000Z',
          quantity: 2,
          type: 'BUY',
          unitPrice: 50,
          value: 100
        },
        {
          SymbolProfile: { symbol: 'BTCUSD' },
          date: '2025-08-17T05:00:00.000Z',
          quantity: 1,
          type: 'BUY',
          unitPrice: 200,
          value: 200
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2025-04-03T05:00:00.000Z',
          quantity: 1,
          type: 'SELL',
          unitPrice: 150,
          value: 150
        },
        {
          SymbolProfile: { symbol: 'USD' },
          date: '2025-12-05T06:00:00.000Z',
          quantity: 1,
          type: 'INTEREST',
          unitPrice: 25,
          value: 25
        }
      ]
    });

    expect(result.categories).toEqual([
      { category: 'BUY', count: 2, totalValue: 300 },
      { category: 'SELL', count: 1, totalValue: 150 },
      { category: 'INTEREST', count: 1, totalValue: 25 }
    ]);
    expect(result.summary).toContain('4 transactions');
    expect(result.patterns).toEqual(
      expect.objectContaining({
        buyCount: 2,
        latestTransactionType: 'INTEREST',
        sellCount: 1,
        totalTransactions: 4
      })
    );
  });

  it('computes pattern metrics with formulas and trend windows', async () => {
    const result = await transactionCategorizeTool({
      message: 'categorize my transactions',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-25T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'BUY',
          unitPrice: 100,
          value: 100
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-20T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'SELL',
          unitPrice: 120,
          value: 120
        },
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2026-02-20T06:00:00.000Z',
          fee: 2,
          quantity: 1,
          type: 'BUY',
          unitPrice: 200,
          value: 200
        },
        {
          SymbolProfile: { symbol: 'USD' },
          date: '2025-12-01T06:00:00.000Z',
          fee: 0,
          quantity: 1,
          type: 'INTEREST',
          unitPrice: 10,
          value: 10
        }
      ]
    });

    expect(result.patterns).toEqual(
      expect.objectContaining({
        activityLast30d: 2,
        activityPrevious30d: 1,
        activityTrend30dVsPrev30dPercent: 100,
        averageTradeSize: 106.5,
        buyCount: 2,
        buySellRatio: 2,
        feeDragPercent: 0.93,
        latestTransactionType: 'BUY',
        sellCount: 1,
        topSymbolByCount: {
          count: 2,
          sharePercent: 50,
          symbol: 'TSLA'
        },
        totalTransactions: 4
      })
    );

    expect(result.computed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          formula: 'BUY_count / SELL_count',
          metric: 'buy_sell_ratio',
          result: 2
        }),
        expect.objectContaining({
          formula: 'sum(abs(netValue)) / transaction_count',
          metric: 'average_trade_size',
          result: 106.5
        }),
        expect.objectContaining({
          formula: '((last_30d_count - previous_30d_count) / previous_30d_count) * 100',
          metric: 'activity_trend_30d_vs_previous_30d_percent',
          result: 100
        }),
        expect.objectContaining({
          formula: 'sum(fee) / sum(abs(grossValue)) * 100',
          metric: 'fee_drag_percent',
          result: 0.93
        })
      ])
    );
    expect(result.answer).toContain('buy/sell ratio 2');
    expect(result.answer).toContain('30d activity trend 100%');
    expect(result.answer).toContain('top symbol TSLA');
  });

  it('surfaces missing-data notes when pattern baselines are unavailable', async () => {
    const result = await transactionCategorizeTool({
      message: 'categorize my transactions',
      transactions: [
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2026-03-28T06:00:00.000Z',
          fee: 0,
          quantity: 1,
          type: 'BUY',
          unitPrice: 150,
          value: 150
        }
      ]
    });

    expect(result.patterns).toEqual(
      expect.objectContaining({
        activityLast30d: 1,
        activityPrevious30d: 0,
        activityTrend30dVsPrev30dPercent: null,
        buySellRatio: null
      })
    );
    expect(result.missing_data).toEqual(
      expect.arrayContaining([
        'buy/sell ratio unavailable because there are no SELL transactions',
        '30d activity trend unavailable because there is no previous 30d baseline'
      ])
    );
  });

  it('applies symbol/type/year filters from the message before categorization', async () => {
    const result = await transactionCategorizeTool({
      message: 'categorize my tsla sell transactions in 2026',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-25T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'BUY',
          unitPrice: 100,
          value: 100
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-20T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'SELL',
          unitPrice: 120,
          value: 120
        },
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2026-02-20T06:00:00.000Z',
          fee: 2,
          quantity: 1,
          type: 'SELL',
          unitPrice: 200,
          value: 200
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2025-12-01T06:00:00.000Z',
          fee: 0,
          quantity: 1,
          type: 'SELL',
          unitPrice: 10,
          value: 10
        }
      ]
    });

    expect(result.categories).toEqual([{ category: 'SELL', count: 1, totalValue: 120 }]);
    expect(result.patterns).toEqual(
      expect.objectContaining({
        buyCount: 0,
        latestTransactionType: 'SELL',
        sellCount: 1,
        totalTransactions: 1
      })
    );
    expect(result.filters).toEqual(
      expect.objectContaining({
        symbol: 'TSLA',
        type: 'SELL',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        matchedCount: 1
      })
    );
  });

  it('supports relative date filters like last year', async () => {
    const result = await transactionCategorizeTool({
      message: 'categorize my transactions from last year',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-25T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'BUY',
          unitPrice: 100,
          value: 100
        },
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2025-02-20T06:00:00.000Z',
          fee: 0,
          quantity: 1,
          type: 'SELL',
          unitPrice: 200,
          value: 200
        }
      ]
    });

    expect(result.filters).toEqual(
      expect.objectContaining({
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        matchedCount: 1
      })
    );
    expect(result.categories).toEqual([{ category: 'SELL', count: 1, totalValue: 200 }]);
  });

  it('uses explicit structured filters when provided', async () => {
    const result = await transactionCategorizeTool({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      message: 'categorize my transactions',
      symbol: 'TSLA',
      transactions: [
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2026-03-25T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'BUY',
          unitPrice: 100,
          value: 100
        },
        {
          SymbolProfile: { symbol: 'TSLA' },
          date: '2025-03-20T06:00:00.000Z',
          fee: 1,
          quantity: 1,
          type: 'SELL',
          unitPrice: 120,
          value: 120
        },
        {
          SymbolProfile: { symbol: 'AAPL' },
          date: '2026-02-20T06:00:00.000Z',
          fee: 2,
          quantity: 1,
          type: 'SELL',
          unitPrice: 200,
          value: 200
        }
      ],
      type: 'BUY'
    });

    expect(result.categories).toEqual([{ category: 'BUY', count: 1, totalValue: 100 }]);
    expect(result.filters).toEqual(
      expect.objectContaining({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        matchedCount: 1,
        symbol: 'TSLA',
        type: 'BUY'
      })
    );
  });
});
