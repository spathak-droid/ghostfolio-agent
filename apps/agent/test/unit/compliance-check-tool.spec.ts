import { complianceCheckTool } from '../../server/tools/compliance-check';

describe('complianceCheckTool', () => {
  it('returns a FINRA suitability violation for recommendation requests without profile fields', async () => {
    const result = await complianceCheckTool({
      message: 'Should I buy TSLA now?',
      createOrderParams: {
        symbol: 'TSLA',
        type: 'BUY',
        quantity: 10
      }
    });

    expect(result.success).toBe(true);
    expect(result.policyVersion).toBe('us-baseline-v1');
    expect(result.isCompliant).toBe(false);
    expect(result.answer).toContain('I ran a compliance check');
    expect(result.answer).toContain('\n\nViolations:\n- ');
    expect(result.answer).toContain('\n\nNext step:\n- ');
    expect(result.answer).toContain('You should not execute this trade yet');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-FINRA-2111',
          severity: 'violation'
        })
      ])
    );
    expect(result.sources).toContain('https://www.finra.org/rules-guidance/rulebooks/finra-rules/2111');
  });

  it('returns compliant when recommendation includes risk profile context', async () => {
    const result = await complianceCheckTool({
      message:
        'Should I buy TSLA? My risk tolerance is moderate, horizon is 10 years, and my constraints are no leverage.',
      createOrderParams: {
        symbol: 'TSLA',
        type: 'BUY',
        quantity: 5
      }
    });

    expect(result.success).toBe(true);
    expect(result.isCompliant).toBe(true);
    expect(result.answer).toContain('no blocking violations or warnings');
    expect(result.violations).toEqual([]);
  });

  it('returns warning for unknown requested regulation filters', async () => {
    const result = await complianceCheckTool({
      message: 'Check compliance',
      regulations: ['R-FINRA-2111', 'R-UNKNOWN-999']
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-UNKNOWN-999',
          severity: 'warning'
        })
      ])
    );
  });

  it('parses regulation ids from plain-text message when regulations[] is not provided', async () => {
    const result = await complianceCheckTool({
      message: 'Check this trade against R-FINRA-2111 and R-IRS-WASH-SALE; should I buy now?'
    });

    expect(result.success).toBe(true);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: 'R-FINRA-2111' })])
    );
  });

  it('always emits provenance metadata even when no findings are returned', async () => {
    const result = await complianceCheckTool({
      message:
        'Should I buy TSLA? My risk tolerance is moderate, horizon is 10 years, and my constraints are no leverage.',
      createOrderParams: {
        symbol: 'TSLA',
        type: 'BUY',
        quantity: 5
      }
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.sources)).toBe(true);
    expect((result.sources ?? []).length).toBeGreaterThan(0);
    expect(typeof result.data_as_of).toBe('string');
  });

  it('returns concentration violation when user asks to invest everything into one asset', async () => {
    const result = await complianceCheckTool({
      message: 'Should I invest all my money in one coin?'
    });

    expect(result.success).toBe(true);
    expect(result.isCompliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-RISK-CONCENTRATION',
          severity: 'violation'
        })
      ])
    );
  });

  it('flags concentration violation for "all your money" phrasing', async () => {
    const result = await complianceCheckTool({
      message: 'You should invest all your money in one stock today'
    });

    expect(result.success).toBe(true);
    expect(result.isCompliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-RISK-CONCENTRATION',
          severity: 'violation'
        })
      ])
    );
  });

  it('returns wash-sale warning when message indicates loss sale and replacement buy', async () => {
    const result = await complianceCheckTool({
      message: 'I sold TSLA at a loss and bought it back two days later. Is this compliant?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-WASH-SALE',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns stale-market-data warning when old quote date is used for current decision', async () => {
    const result = await complianceCheckTool({
      message: 'Should I buy AAPL now using quote data as of 2025-01-01?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-MARKET-DATA-STALE',
          severity: 'warning'
        })
      ])
    );
  });

  it('prefers LLM-extracted compliance facts when provided', async () => {
    const llmFactExtractor = jest.fn().mockResolvedValue({
      concentration_risk: true,
      constraints: true,
      horizon: true,
      is_recommendation: true,
      quote_staleness_check: false,
      replacement_buy_signal: false,
      risk_tolerance: true,
      transaction_type: 'BUY'
    });
    const result = await complianceCheckTool({
      llmFactExtractor,
      message: 'Put every dollar into BTC immediately.'
    });

    expect(llmFactExtractor).toHaveBeenCalledWith('Put every dollar into BTC immediately.');
    expect(result.success).toBe(true);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: 'R-RISK-CONCENTRATION' })])
    );
  });

  it('falls back to deterministic inference when LLM extraction is unavailable', async () => {
    const llmFactExtractor = jest.fn().mockResolvedValue(undefined);
    const result = await complianceCheckTool({
      llmFactExtractor,
      message: 'Should I invest all my money in one coin?'
    });

    expect(llmFactExtractor).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: 'R-RISK-CONCENTRATION' })])
    );
  });

  it('returns capital gains warning when user asks about capital gains taxation', async () => {
    const result = await complianceCheckTool({
      message: 'What are the capital gains tax implications if I sell this stock?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-CAPITAL-GAINS',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns IRA contribution limits warning for ira contribution planning questions', async () => {
    const result = await complianceCheckTool({
      message: 'Can I still contribute to my IRA this year and what are the limits?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-IRA-LIMITS',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns RMD warning when user asks about required minimum distributions', async () => {
    const result = await complianceCheckTool({
      message: 'Do I need to take an RMD from my IRA this year?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-RMD',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns NIIT warning when user asks about 3.8% investment income tax', async () => {
    const result = await complianceCheckTool({
      message: 'Would the 3.8% NIIT apply to my investment income?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-NIIT',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns qualified dividends warning when user asks about qualified dividend taxation', async () => {
    const result = await complianceCheckTool({
      message: 'Do these qualified dividends get taxed at lower rates?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-QUALIFIED-DIVIDENDS',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns tax-loss harvesting warning when user asks about harvesting losses', async () => {
    const result = await complianceCheckTool({
      message: 'Can I use tax-loss harvesting here to offset gains?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-TAX-LOSS-HARVESTING',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns cost basis warning when user asks about basis methods', async () => {
    const result = await complianceCheckTool({
      message: 'Should I use FIFO or specific identification for cost basis?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-COST-BASIS',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns AMT warning when user asks about alternative minimum tax', async () => {
    const result = await complianceCheckTool({
      message: 'Will AMT change this investment tax outcome?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-IRS-AMT',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns ETF tax efficiency warning when user asks about ETF tax claims', async () => {
    const result = await complianceCheckTool({
      message: 'Are ETF tax efficiency claims always true in taxable accounts?'
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'R-SEC-ETF-TAX-EFFICIENCY',
          severity: 'warning'
        })
      ])
    );
  });
});
