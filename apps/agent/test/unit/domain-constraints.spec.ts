import { applyDomainConstraints } from '../../server/verification/domain-constraints';

describe('domain constraints', () => {
  it('flags deterministic financial advice phrasing', () => {
    const constrained = applyDomainConstraints(
      'You should invest all your money in one stock today.',
      []
    );

    expect(constrained.isValid).toBe(false);
    expect(constrained.flags).toContain('deterministic_financial_advice');
  });

  it('allows general education responses without provenance flags', () => {
    const constrained = applyDomainConstraints('Hello! How can I help?', ['missing_provenance'], {
      intent: 'general'
    });

    expect(constrained.isValid).toBe(true);
    expect(constrained.flags).not.toContain('missing_provenance');
  });

  it('keeps USD cash classification warning but does not invalidate response', () => {
    const constrained = applyDomainConstraints('Portfolio includes cash details.', [
      'USD_SHOULD_BE_CASH_NOT_HOLDING'
    ]);

    expect(constrained.flags).toContain('USD_SHOULD_BE_CASH_NOT_HOLDING');
    expect(constrained.isValid).toBe(true);
  });
});
