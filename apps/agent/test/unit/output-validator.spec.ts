import { validateOutput } from '../../server/verification/output-validator';
import type { AgentToolCall } from '../../server/types';

describe('validateOutput', () => {
  it('passes valid factual output with provenance', () => {
    const result = validateOutput({
      answer: 'AAPL is 210.12 USD.',
      intent: 'finance',
      toolCalls: [
        {
          toolName: 'market_data',
          success: true,
          result: {
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            symbols: [{ currentPrice: 210.12, symbol: 'AAPL' }]
          }
        } as AgentToolCall
      ]
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails with missing provenance for factual tool outputs', () => {
    const result = validateOutput({
      answer: 'AAPL is 210.12 USD.',
      intent: 'finance',
      toolCalls: [
        {
          toolName: 'market_data',
          success: true,
          result: {
            symbols: [{ currentPrice: 210.12, symbol: 'AAPL' }]
          }
        } as AgentToolCall
      ]
    });

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain('VALIDATION_MISSING_PROVENANCE');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fails with non-finite number in tool payload', () => {
    const result = validateOutput({
      answer: 'AAPL is unavailable.',
      intent: 'finance',
      toolCalls: [
        {
          toolName: 'market_data',
          success: true,
          result: {
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            symbols: [{ currentPrice: Number.NaN, symbol: 'AAPL' }]
          }
        } as AgentToolCall
      ]
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('VALIDATION_NON_FINITE_NUMBER');
    expect(result.severeErrors).toContain('VALIDATION_NON_FINITE_NUMBER');
  });

  it('fails completeness when compliance violations exist without actionable next step guidance', () => {
    const result = validateOutput({
      answer: 'There are violations.',
      intent: 'finance',
      toolCalls: [
        {
          toolName: 'compliance_check',
          success: true,
          result: {
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['policy_pack:us-baseline-v1'],
            violations: [{ message: 'Suitability missing', rule_id: 'R-FINRA-2111' }]
          }
        } as AgentToolCall
      ]
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('VALIDATION_INCOMPLETE_COMPLIANCE_GUIDANCE');
    expect(result.severeErrors).toContain('VALIDATION_INCOMPLETE_COMPLIANCE_GUIDANCE');
  });

  it('keeps backward compatibility for string-only invocation', () => {
    expect(validateOutput('ok').isValid).toBe(true);
    expect(validateOutput('').errors).toContain('VALIDATION_EMPTY_ANSWER');
  });
});
