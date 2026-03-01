import {
  validateToolArgs,
  type ValidateToolArgsResult
} from '../../server/validation/tool-args-validator';

function errorOf(r: ValidateToolArgsResult): string | undefined {
  return r.ok ? undefined : (r as { ok: false; error: string }).error;
}

describe('validateToolArgs', () => {
  it('returns ok for empty args', () => {
    expect(validateToolArgs('portfolio_analysis', {})).toEqual({ ok: true });
  });

  it('returns ok for valid take in range', () => {
    expect(validateToolArgs('get_transactions', { take: 10 })).toEqual({ ok: true });
    expect(validateToolArgs('get_transactions', { take: 1 })).toEqual({ ok: true });
    expect(validateToolArgs('get_transactions', { take: 1000 })).toEqual({ ok: true });
  });

  it('rejects take below TAKE_MIN', () => {
    const result = validateToolArgs('get_transactions', { take: 0 });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('between 1 and 1000');
  });

  it('rejects take above TAKE_MAX', () => {
    const result = validateToolArgs('get_transactions', { take: 1001 });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('between 1 and 1000');
  });

  it('rejects non-finite take', () => {
    const result = validateToolArgs('get_transactions', { take: NaN });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('finite number');
  });

  it('returns ok for valid dateFrom/dateTo', () => {
    expect(
      validateToolArgs('transaction_timeline', {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31'
      })
    ).toEqual({ ok: true });
  });

  it('rejects dateFrom after dateTo', () => {
    const result = validateToolArgs('transaction_timeline', {
      dateFrom: '2024-12-31',
      dateTo: '2024-01-01'
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('dateFrom must be before');
  });

  it('rejects invalid dateFrom format', () => {
    const result = validateToolArgs('transaction_timeline', {
      dateFrom: 'not-a-date'
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('dateFrom must be YYYY-MM-DD');
  });

  it('returns ok for valid range values', () => {
    expect(validateToolArgs('market_data', { range: 'max' })).toEqual({ ok: true });
    expect(validateToolArgs('market_data', { range: '1y' })).toEqual({ ok: true });
    expect(validateToolArgs('market_data', { range: '1d' })).toEqual({ ok: true });
  });

  it('rejects invalid range', () => {
    const result = validateToolArgs('market_data', { range: 'invalid' });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('range must be one of');
  });

  it('returns ok for valid symbol', () => {
    expect(validateToolArgs('analyze_stock_trend', { symbol: 'AAPL' })).toEqual({ ok: true });
    expect(validateToolArgs('analyze_stock_trend', { symbol: 'BTC-USD' })).toEqual({ ok: true });
  });

  it('rejects symbol that exceeds length or invalid pattern', () => {
    const result = validateToolArgs('analyze_stock_trend', {
      symbol: 'a'.repeat(33)
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('symbol');
  });

  it('returns ok for valid symbols array', () => {
    expect(
      validateToolArgs('market_data', { symbols: ['AAPL', 'MSFT'] })
    ).toEqual({ ok: true });
  });

  it('returns ok for symbol search phrases with spaces (lookup query)', () => {
    expect(
      validateToolArgs('market_data', { symbols: ['binance coin'] })
    ).toEqual({ ok: true });
    expect(
      validateToolArgs('market_data', { symbols: ['Apple Inc', 'bitcoin'] })
    ).toEqual({ ok: true });
  });

  it('rejects symbols array over MAX_ARRAY_LENGTH', () => {
    const result = validateToolArgs('market_data', {
      symbols: Array(51).fill('AAPL')
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('at most 50');
  });

  it('rejects empty string in symbols array', () => {
    const result = validateToolArgs('market_data', { symbols: ['AAPL', '  ', 'MSFT'] });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('symbols');
  });

  it('returns ok for valid regulations array', () => {
    expect(
      validateToolArgs('compliance_check', { regulations: ['R-FINRA-2111'] })
    ).toEqual({ ok: true });
  });

  it('rejects regulations array over MAX_ARRAY_LENGTH', () => {
    const result = validateToolArgs('compliance_check', {
      regulations: Array(51).fill('R-X')
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('at most 50');
  });

  it('rejects empty string in regulations array', () => {
    const result = validateToolArgs('compliance_check', {
      regulations: ['R-FINRA-2111', '']
    });
    expect(result.ok).toBe(false);
    expect(errorOf(result)).toContain('regulations');
  });
});
