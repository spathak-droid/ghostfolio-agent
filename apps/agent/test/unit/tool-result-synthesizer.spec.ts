import { synthesizeToolResults } from '../../server/synthesis/tool-result-synthesizer';

describe('synthesizeToolResults', () => {
  it('builds findings from portfolio holdings and summary when allocation is not provided', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            summary: 'Portfolio analysis from Ghostfolio data',
            data: {
              holdings: {
                USD: { symbol: 'USD', allocationInPercentage: 0.9810686979 },
                BTCUSD: { symbol: 'BTCUSD', allocationInPercentage: 0.0188202092 }
              },
              summary: {
                netPerformance: -4961.43,
                netPerformancePercentage: -0.05706165
              },
              sources: ['ghostfolio_api'],
              data_as_of: '2026-02-24T05:27:01.343Z'
            }
          }
        }
      ]
    });

    expect(response.answer).toContain('Top allocation: BTCUSD 1.88%.');
    expect(response.answer).toContain('Net performance: -4961.43');
    expect(response.answer).toContain('Net performance %: -5.71%');
    expect(response.flags).not.toContain('missing_provenance');
  });

  it('adds USD_SHOULD_BE_CASH_NOT_HOLDING when portfolio_analysis had USD in holdings', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            allocation: [{ percentage: 20, symbol: 'BTCUSD' }],
            data_as_of: '2026-02-24T12:00:00.000Z',
            sources: ['ghostfolio_api'],
            summary: 'Portfolio analysis from Ghostfolio data',
            usd_removed_from_holdings: true,
            data: {
              holdings: { USD: { symbol: 'USD', allocationInPercentage: 0.8 }, BTCUSD: { symbol: 'BTCUSD', allocationInPercentage: 0.2 } },
              summary: { cash: 5000 },
              sources: ['ghostfolio_api'],
              data_as_of: '2026-02-24T12:00:00.000Z'
            }
          }
        }
      ]
    });
    expect(response.flags).toContain('USD_SHOULD_BE_CASH_NOT_HOLDING');
    expect(response.answer).toContain('Cash (USD): 5000');
  });

  it('surfaces freshest data_as_of and missing_data in final answer', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'transaction_timeline',
          success: true,
          result: {
            data_as_of: '2026-02-24T06:00:00.000Z',
            missing_data: ['No matching transactions for requested filters'],
            sources: ['agent_internal'],
            summary: 'Found 0 matching transactions',
            timeline: []
          }
        },
        {
          toolName: 'market_data_lookup',
          success: true,
          result: {
            data_as_of: '2026-02-24T06:10:00.000Z',
            prices: [{ symbol: 'AAPL', value: 192.12 }],
            sources: ['ghostfolio_api'],
            summary: 'AAPL last trade 192.12 USD'
          }
        }
      ]
    });

    expect(response.answer).toContain('Data as of: 2026-02-24T06:10:00.000Z');
    expect(response.answer).toContain(
      'Missing data: No matching transactions for requested filters'
    );
  });
});
