import { normalizeTransactions } from '../../server/tools/transaction-data';

describe('transaction-data normalization', () => {
  it('computes P1/P2 fields including totalCost and positionAfter', () => {
    const normalized = normalizeTransactions([
      {
        id: 't1',
        accountId: 'a1',
        account: { name: 'Main' },
        userId: 'u1',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T11:00:00.000Z',
        currency: 'USD',
        date: '2026-01-01T00:00:00.000Z',
        fee: 2,
        quantity: 2,
        type: 'BUY',
        unitPrice: 100,
        value: 200,
        valueInBaseCurrency: 200,
        SymbolProfile: {
          symbol: 'TSLA',
          name: 'Tesla, Inc.',
          dataSource: 'YAHOO',
          figi: 'BBG000N9MNX3',
          isin: null,
          assetClass: 'EQUITY',
          assetSubClass: 'STOCK',
          sectors: [{ name: 'Consumer Cyclical', weight: 1 }],
          countries: [{ code: 'US', weight: 1 }]
        }
      },
      {
        id: 't2',
        accountId: 'a1',
        account: { name: 'Main' },
        userId: 'u1',
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-02T11:00:00.000Z',
        currency: 'USD',
        date: '2026-01-02T00:00:00.000Z',
        fee: 1,
        quantity: 1,
        type: 'SELL',
        unitPrice: 150,
        value: 150,
        valueInBaseCurrency: 150,
        SymbolProfile: {
          symbol: 'TSLA',
          name: 'Tesla, Inc.',
          dataSource: 'YAHOO',
          figi: 'BBG000N9MNX3',
          isin: null,
          assetClass: 'EQUITY',
          assetSubClass: 'STOCK',
          sectors: [{ name: 'Consumer Cyclical', weight: 1 }],
          countries: [{ code: 'US', weight: 1 }]
        }
      }
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toEqual(
      expect.objectContaining({
        activityId: 't1',
        dataSource: 'YAHOO',
        fee: 2,
        feesIncludedInValue: false,
        positionAfter: 2,
        priceType: 'execution',
        totalCost: 202
      })
    );
    expect(normalized[1]).toEqual(
      expect.objectContaining({
        positionAfter: 1,
        totalCost: 150
      })
    );
  });
});
