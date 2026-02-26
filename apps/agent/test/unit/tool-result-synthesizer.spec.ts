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

  it('explains whether portfolio is in profit or loss from net performance', () => {
    const inProfit = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            data_as_of: '2026-02-24T06:10:00.000Z',
            performance: {
              netPerformance: 1200.45,
              netPerformancePercentage: 0.12
            },
            sources: ['ghostfolio_api'],
            summary: 'Portfolio analysis from Ghostfolio data'
          }
        }
      ]
    });

    const inLoss = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            data_as_of: '2026-02-24T06:10:00.000Z',
            performance: {
              netPerformance: -450.11,
              netPerformancePercentage: -0.045
            },
            sources: ['ghostfolio_api'],
            summary: 'Portfolio analysis from Ghostfolio data'
          }
        }
      ]
    });

    expect(inProfit.answer).toContain('Portfolio status: in profit');
    expect(inLoss.answer).toContain('Portfolio status: in loss');
  });

  it('includes transaction pattern findings when categorization returns patterns', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'transaction_categorize',
          success: true,
          result: {
            categories: [
              { category: 'BUY', count: 2, totalValue: 300 },
              { category: 'SELL', count: 1, totalValue: 150 }
            ],
            data_as_of: '2026-04-01T00:00:00.000Z',
            patterns: {
              buySellRatio: 2,
              activityTrend30dVsPrev30dPercent: 100,
              topSymbolByCount: {
                symbol: 'TSLA',
                sharePercent: 50
              }
            },
            sources: ['agent_internal'],
            summary: 'Transaction categorization completed for 4 transactions'
          }
        }
      ]
    });

    expect(response.answer).toContain('Transaction categories: BUY (2), SELL (1).');
    expect(response.answer).toContain(
      'Transaction patterns: buy/sell ratio 2, 30d activity trend 100%, top symbol TSLA (50%).'
    );
  });

  it('ignores contradictory textual summary and uses structured transaction fields', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'transaction_categorize',
          success: true,
          result: {
            answer: 'buy/sell ratio unavailable (no sells)',
            summary: 'no sells found',
            categories: [
              { category: 'BUY', count: 13, totalValue: 3000 },
              { category: 'SELL', count: 3, totalValue: 1400 }
            ],
            data_as_of: '2026-04-01T00:00:00.000Z',
            patterns: {
              buySellRatio: 4.33,
              totalTransactions: 16,
              topSymbolByCount: {
                symbol: 'SOL-USD',
                sharePercent: 37.5
              }
            },
            sources: ['agent_internal']
          }
        }
      ]
    });

    expect(response.answer).toContain('Summary: Categorized 16 transactions.');
    expect(response.answer).toContain('Transaction categories: BUY (13), SELL (3).');
    expect(response.answer).toContain('Transaction patterns: buy/sell ratio 4.33, top symbol SOL-USD (37.5%).');
    expect(response.answer).not.toContain('no sells');
    expect(response.answer).not.toContain('unavailable');
  });

  it('builds market-data summary from structured payload instead of text summary', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'market_data',
          success: true,
          result: {
            summary: 'market feed unavailable',
            data_as_of: '2026-04-01T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            symbols: [
              { symbol: 'AAPL', currency: 'USD', currentPrice: 210.12, changePercent1m: 2.4 },
              { symbol: 'TSLA', currency: 'USD', currentPrice: 190.45, changePercent1w: -1.1 }
            ]
          }
        }
      ]
    });

    expect(response.answer).toContain('Summary: Market data returned for 2 symbol(s).');
    expect(response.answer).toContain('Market data: AAPL: USD 210.12 (+2.4% vs 1m ago); TSLA: USD 190.45 (-1.1% vs 1w ago).');
    expect(response.answer).not.toContain('market feed unavailable');
  });

  it('reads structured per-symbol market-data error payloads', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'market_data',
          success: true,
          result: {
            data_as_of: '2026-04-01T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            symbols: [
              {
                symbol: 'BTC',
                error: {
                  error_code: 'MARKET_PRICE_MISSING',
                  message: 'Missing market price for COINGECKO bitcoin',
                  retryable: false
                }
              }
            ]
          }
        }
      ]
    });

    expect(response.answer).toContain('BTC: Missing market price for COINGECKO bitcoin');
  });

  it('lists compliance violations and warnings with rule ids in risks', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'compliance_check',
          success: true,
          result: {
            data_as_of: '2026-02-26',
            policyVersion: 'us-baseline-v1',
            sources: ['policy_pack:us-baseline-v1'],
            summary: 'Compliance check completed with 1 violation(s) and 1 warning(s).',
            violations: [
              {
                rule_id: 'R-FINRA-2111',
                message: 'Suitability inputs are required before personalized buy/sell guidance.'
              }
            ],
            warnings: [
              {
                rule_id: 'R-IRS-WASH-SALE',
                message: 'Potential wash sale window detected; review tax treatment.'
              }
            ]
          }
        }
      ]
    });

    expect(response.answer).toContain('Compliance check: 1 violation(s), 1 warning(s).');
    expect(response.answer).toContain(
      'Violation (R-FINRA-2111): Suitability inputs are required before personalized buy/sell guidance.'
    );
    expect(response.answer).toContain(
      'Warning (R-IRS-WASH-SALE): Potential wash sale window detected; review tax treatment.'
    );
  });
});
