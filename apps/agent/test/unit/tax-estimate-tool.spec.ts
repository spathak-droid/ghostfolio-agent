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
});
