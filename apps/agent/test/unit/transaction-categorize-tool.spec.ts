import { transactionCategorizeTool } from '../../server/tools/transaction-categorize';

describe('transactionCategorizeTool', () => {
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
        latestTransactionType: 'INTEREST',
        totalTransactions: 4
      })
    );
  });
});
