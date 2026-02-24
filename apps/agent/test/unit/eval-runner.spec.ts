import { runEvalCases } from '../../server/eval/eval-runner';

describe('eval runner', () => {
  it('runs cases and returns pass/fail summary', async () => {
    const result = await runEvalCases([
      {
        expectedContains: 'Portfolio analysis',
        expectedTool: 'portfolio_analysis',
        input: 'Analyze my portfolio allocation'
      },
      {
        expectedContains: 'Market data lookup',
        expectedTool: 'market_data_lookup',
        input: 'Get market data for AAPL'
      },
      {
        expectedFlag: 'deterministic_financial_advice',
        input: 'You should invest all your money in one stock today'
      }
    ]);

    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(0);
  });
});
