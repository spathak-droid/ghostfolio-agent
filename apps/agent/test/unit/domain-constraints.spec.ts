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
});
