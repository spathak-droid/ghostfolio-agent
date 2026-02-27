import { taxEstimateTool } from '../../server/tools/tax-estimate';

describe('tax estimate tool', () => {
  it('computes realized gains/losses and returns estimate payload', async () => {
    const client = {
      getTransactions: jest.fn().mockResolvedValue({
        activities: [
          {
            date: '2025-01-01T00:00:00.000Z',
            fee: 0,
            quantity: 10,
            type: 'BUY',
            unitPrice: 100,
            SymbolProfile: { symbol: 'AAPL' }
          },
          {
            date: '2026-01-10T00:00:00.000Z',
            fee: 0,
            quantity: 5,
            type: 'SELL',
            unitPrice: 130,
            SymbolProfile: { symbol: 'AAPL' }
          },
          {
            date: '2026-01-11T00:00:00.000Z',
            fee: 0,
            quantity: 1,
            type: 'DIVIDEND',
            unitPrice: 50,
            SymbolProfile: { symbol: 'AAPL' }
          }
        ]
      })
    } as never;

    const result = await taxEstimateTool({
      client,
      message: 'estimate tax for 2026 single with ordinary income 100000'
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`expected success but got error: ${result.error?.message ?? 'unknown'}`);
    }
    const ok = result as Record<string, unknown> & {
      tax_year: number;
      filing_status: string;
      realized: { long_term_gains: number };
      income: { dividends: number };
      estimate: { total_estimated_federal_tax: number };
      scenario_estimate?: unknown;
      sources: string[];
      answer: string;
    };
    expect(ok.tax_year).toBe(2026);
    expect(ok.filing_status).toBe('single');
    expect(ok.realized.long_term_gains).toBe(150);
    expect(ok.income.dividends).toBe(50);
    expect(ok.estimate.total_estimated_federal_tax).toBeGreaterThan(0);
    expect(ok.scenario_estimate).toBeUndefined();
    expect(ok.sources).toEqual(
      expect.arrayContaining(['ghostfolio_api', 'docs/agent/tax/us/federal/2026.json'])
    );
    expect(ok.answer).toContain('your estimated federal tax is USD');
    expect(ok.answer).toContain('Not financial advice.');
  });

  it('returns structured error when tax table is missing', async () => {
    const client = {
      getTransactions: jest.fn().mockResolvedValue({ activities: [] })
    } as never;

    const result = await taxEstimateTool({
      client,
      message: 'estimate tax for 2099 single'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.summary).toContain('Tax estimate failed');
    expect(result.answer).toContain('Not financial advice.');
    expect(result.answer).toContain(
      'Please consult with your financial advisor and a qualified tax professional before making decisions.'
    );
  });

  it('adds scenario estimate when ordinary income is not provided', async () => {
    const client = {
      getTransactions: jest.fn().mockResolvedValue({
        activities: [
          {
            date: '2025-01-01T00:00:00.000Z',
            fee: 0,
            quantity: 10,
            type: 'BUY',
            unitPrice: 100,
            SymbolProfile: { symbol: 'AAPL' }
          },
          {
            date: '2026-01-10T00:00:00.000Z',
            fee: 0,
            quantity: 5,
            type: 'SELL',
            unitPrice: 130,
            SymbolProfile: { symbol: 'AAPL' }
          }
        ]
      })
    } as never;

    const result = await taxEstimateTool({
      client,
      message: 'estimate my tax for 2026 single'
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`expected success but got error: ${result.error?.message ?? 'unknown'}`);
    }
    const ok = result as Record<string, unknown> & {
      estimate: { total_estimated_federal_tax: number };
      scenario_estimate?: { ordinary_income_assumed: number };
      illustrative?: boolean;
      missing_params?: { param: string; question: string }[];
      answer: string;
    };
    expect(ok.scenario_estimate).toBeDefined();
    expect(ok.scenario_estimate?.ordinary_income_assumed).toBe(60_000);
    expect(ok.illustrative).toBe(true);
    expect(ok.estimate.total_estimated_federal_tax).toBeGreaterThan(0);
    expect(ok.missing_params).toBeDefined();
    expect(ok.missing_params).toHaveLength(1);
    expect(ok.missing_params![0].param).toBe('ordinary_income');
    expect(ok.answer).toContain('To give you a personalized estimate, I need a few details');
    expect(ok.answer).toContain('example scenario');
    expect(ok.answer).toContain('60,000');
    expect(ok.answer).toContain(
      'Please consult with your financial advisor and a qualified tax professional before making decisions.'
    );
  });

  it('returns missing_params and asks for all when no params provided', async () => {
    const client = {
      getTransactions: jest.fn().mockResolvedValue({ activities: [] })
    } as never;

    const result = await taxEstimateTool({
      client,
      message: 'calculate my taxes'
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    const ok = result as Record<string, unknown> & {
      missing_params?: { param: string; question: string }[];
      answer: string;
    };
    expect(ok.missing_params).toBeDefined();
    expect(ok.missing_params).toHaveLength(3);
    const params = (ok.missing_params ?? []).map((p) => p.param).sort();
    expect(params).toEqual(['filing_status', 'ordinary_income', 'tax_year']);
    expect(ok.answer).toContain('To give you a personalized estimate, I need a few details');
    expect(ok.answer).toContain('Which tax year');
    expect(ok.answer).toContain('filing status');
    expect(ok.answer).toContain('annual ordinary income');
    expect(ok.answer).toContain('example scenario');
  });

  it('detects asset classes and qualified dividends for US equities', async () => {
    const client = {
      getTransactions: jest.fn().mockResolvedValue({
        activities: [
          // BUY crypto
          {
            date: '2025-01-01T00:00:00.000Z',
            fee: 0,
            quantity: 0.5,
            type: 'BUY',
            unitPrice: 50000,
            SymbolProfile: { symbol: 'BTC-USD', assetClass: 'LIQUIDITY', assetSubClass: 'CRYPTOCURRENCY', countries: [] }
          },
          // SELL crypto (short-term gain)
          {
            date: '2025-06-01T00:00:00.000Z',
            fee: 0,
            quantity: 0.25,
            type: 'SELL',
            unitPrice: 60000,
            SymbolProfile: { symbol: 'BTC-USD', assetClass: 'LIQUIDITY', assetSubClass: 'CRYPTOCURRENCY', countries: [] }
          },
          // BUY US stock
          {
            date: '2025-03-01T00:00:00.000Z',
            fee: 0,
            quantity: 10,
            type: 'BUY',
            unitPrice: 150,
            SymbolProfile: { symbol: 'AAPL', assetClass: 'EQUITY', assetSubClass: 'STOCK', countries: [{ code: 'US' }] }
          },
          // SELL US stock (long-term gain)
          {
            date: '2026-04-01T00:00:00.000Z',
            fee: 0,
            quantity: 5,
            type: 'SELL',
            unitPrice: 180,
            SymbolProfile: { symbol: 'AAPL', assetClass: 'EQUITY', assetSubClass: 'STOCK', countries: [{ code: 'US' }] }
          },
          // DIVIDEND from US stock (should be qualified)
          {
            date: '2026-02-01T00:00:00.000Z',
            fee: 0,
            quantity: 1,
            type: 'DIVIDEND',
            unitPrice: 100,
            SymbolProfile: { symbol: 'AAPL', assetClass: 'EQUITY', assetSubClass: 'STOCK', countries: [{ code: 'US' }] }
          }
        ]
      })
    } as never;

    const result = await taxEstimateTool({
      client,
      message: 'estimate tax for 2026 single with ordinary income 100000'
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`expected success but got error: ${result.error?.message ?? 'unknown'}`);
    }
    const ok = result as Record<string, unknown> & {
      by_asset_class?: Record<
        string,
        { short_term_gains: number; short_term_losses: number; long_term_gains: number; long_term_losses: number }
      >;
      open_positions?: Array<{
        symbol: string;
        quantity: number;
        days_held: number;
        is_long_term: boolean;
        days_until_long_term: number;
      }>;
      insights?: string[];
      income?: { qualified_dividends: number };
      missing_params?: { param: string; question: string }[];
    };

    // Assert by_asset_class tracking
    expect(ok.by_asset_class).toBeDefined();
    expect(ok.by_asset_class?.crypto.short_term_gains).toBeGreaterThan(0); // BTC sold at gain
    expect(ok.by_asset_class?.equity.long_term_gains).toBeGreaterThan(0); // AAPL sold at gain (long-term)

    // Assert qualified dividends auto-detected
    expect(ok.income?.qualified_dividends).toBe(100); // DIVIDEND from US stock
    // Should NOT ask for qualified dividends in missing_params
    const hasQualifiedDividendQuestion = ok.missing_params?.some((p) => p.param === 'qualified_dividends');
    expect(hasQualifiedDividendQuestion).toBeFalsy();

    // Assert open_positions
    expect(ok.open_positions).toBeDefined();
    expect(ok.open_positions!.length).toBeGreaterThan(0);
    const btcPosition = ok.open_positions!.find((p) => p.symbol === 'BTC-USD');
    expect(btcPosition).toBeDefined();
    expect(btcPosition!.quantity).toBeCloseTo(0.25, 2); // 0.5 - 0.25
    expect(btcPosition!.days_held).toBeGreaterThan(150); // Held since Jan 2025
    expect(btcPosition!.is_long_term).toBe(true);
    expect(btcPosition!.days_until_long_term).toBe(0);

    const aaplPosition = ok.open_positions!.find((p) => p.symbol === 'AAPL');
    expect(aaplPosition).toBeDefined();
    expect(aaplPosition!.quantity).toBe(5); // 10 - 5

    // Assert insights
    expect(ok.insights).toBeDefined();
    expect(Array.isArray(ok.insights)).toBe(true);
    expect(ok.insights!.length).toBeGreaterThan(0);
    // Should have insight about qualified dividends
    const hasQualifiedDividendInsight = ok.insights!.some((i) => i.toLowerCase().includes('qualified'));
    expect(hasQualifiedDividendInsight).toBe(true);
  });
});
