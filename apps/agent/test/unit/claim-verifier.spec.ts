import { verifyClaimsAgainstToolEvidence } from '../../server/verification/claim-verifier';

describe('claim verifier', () => {
  it('flags fact-check mismatch from fact_check comparisons', () => {
    const result = verifyClaimsAgainstToolEvidence({
      answer: 'Answer: Fact check shows mismatch.',
      message: 'verify bitcoin price',
      toolCalls: [
        {
          toolName: 'fact_check',
          success: true,
          result: {
            comparisons: [
              { symbol: 'BTCUSD', primaryPrice: 100000, secondaryPrice: 103000, match: false }
            ],
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['ghostfolio_api', 'coingecko']
          }
        }
      ]
    });

    expect(result.flags).toContain('fact_check_mismatch');
  });

  it('flags unsupported claims when answer includes symbol+price not present in tool evidence', () => {
    const result = verifyClaimsAgainstToolEvidence({
      answer: 'Latest prices: AAPL 999.99.',
      message: 'get market data for aapl',
      toolCalls: [
        {
          toolName: 'market_data_lookup',
          success: true,
          result: {
            prices: [{ symbol: 'AAPL', value: 210.12 }],
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        }
      ]
    });

    expect(result.flags).toContain('unsupported_claim');
  });

  it('does not flag supported claims', () => {
    const result = verifyClaimsAgainstToolEvidence({
      answer: 'Latest prices: AAPL 210.12.',
      message: 'get market data for aapl',
      toolCalls: [
        {
          toolName: 'market_data_lookup',
          success: true,
          result: {
            prices: [{ symbol: 'AAPL', value: 210.12 }],
            data_as_of: '2026-02-27T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        }
      ]
    });

    expect(result.flags).not.toContain('unsupported_claim');
  });
});
