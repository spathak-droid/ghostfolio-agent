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

    expect(response.answer).toContain('Data as of:');
    expect(response.answer).toContain('Date: 2026-02-24');
    expect(response.answer).toContain('Time: 06:10:00.000');
    expect(response.answer).toContain('Timezone: Z');
    expect(response.answer).toContain(
      'Missing data: No matching transactions for requested filters'
    );
  });

  it('omits data freshness section when freshest data_as_of is today (UTC)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-27T18:19:51.173Z'));
    try {
      const response = synthesizeToolResults({
        existingFlags: [],
        toolCalls: [
          {
            toolName: 'market_data_lookup',
            success: true,
            result: {
              data_as_of: '2026-02-27T02:19:51.173Z',
              prices: [{ symbol: 'AAPL', value: 192.12 }],
              sources: ['ghostfolio_api'],
              summary: 'AAPL last trade 192.12 USD'
            }
          }
        ]
      });

      expect(response.answer).not.toContain('Data as of:');
      expect(response.answer).not.toContain('Missing data:');
    } finally {
      jest.useRealTimers();
    }
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

  it('surfaces year-over-year market-data comparisons when provided', () => {
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
                symbol: 'BTC-USD',
                currency: 'USD',
                currentPrice: 67492,
                changePercent1y: 32.34
              }
            ]
          }
        }
      ]
    });

    expect(response.answer).toContain('BTC-USD: USD 67492 (+32.34% vs 1y ago)');
  });

  it('adds richer next steps when feedback memory requests actionable planning', () => {
    const response = synthesizeToolResults({
      feedbackMemory: {
        do: ['Provide actionable next steps.'],
        dont: [],
        sources: 2,
        synthesisIssues: ['Previous response lacked plan quality.'],
        toolIssues: []
      },
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'market_data_lookup',
          success: true,
          result: {
            data_as_of: '2026-04-01T00:00:00.000Z',
            prices: [{ symbol: 'AAPL', value: 192.12 }],
            sources: ['ghostfolio_api'],
            summary: 'AAPL last trade 192.12 USD'
          }
        }
      ]
    });

    expect(response.answer).toContain(
      'Write down entry/exit levels and the invalidation threshold before trading.'
    );
    expect(response.answer).toContain(
      'Verify one independent data point (volume, catalyst, or macro event) before execution.'
    );
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
      'No, you should not proceed yet because compliance check found 1 blocking violation(s).'
    );
    expect(response.answer).toContain(
      'Violation (R-FINRA-2111): Suitability inputs are required before personalized buy/sell guidance.'
    );
    expect(response.answer).toContain(
      'Warning (R-IRS-WASH-SALE): Potential wash sale window detected; review tax treatment.'
    );
  });

  it('splits pipe-delimited compliance findings into separate risk lines', () => {
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
            summary: 'Compliance check completed with 1 violation(s) and 0 warning(s).',
            violations: [
              'R-FINRA-2111: Suitability inputs are required before personalized buy/sell guidance. | R-RISK-CONCENTRATION: Concentration risk is too high.'
            ],
            warnings: []
          }
        }
      ]
    });

    expect(response.answer).toContain(
      'Violation (R-FINRA-2111): Suitability inputs are required before personalized buy/sell guidance.'
    );
    expect(response.answer).toContain(
      'Violation (R-RISK-CONCENTRATION): Concentration risk is too high.'
    );
  });

  it('omits account/platform balances for portfolio allocation prompts by default', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      userMessage: 'Analyze my portfolio allocation',
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            allocation: [
              { percentage: 60, symbol: 'BTCUSD' },
              { percentage: 40, symbol: 'TSLA' }
            ],
            data: {
              accountBalances: [
                { accountName: 'My Account', balance: 1000, currency: 'USD', balanceInBaseCurrency: 1000 }
              ],
              accounts: [{ name: 'Platform', balance: 1000, currency: 'USD' }],
              summary: { cash: 1000 }
            },
            sources: ['ghostfolio_api'],
            data_as_of: '2026-02-26T00:00:00.000Z'
          }
        }
      ]
    });

    expect(response.answer).toContain('Top allocation: BTCUSD 60%, TSLA 40%.');
    expect(response.answer).not.toContain('Account balances:');
    expect(response.answer).not.toContain('Platform balances:');
  });

  it('extracts portfolio evolution insights from chart data', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            chart: [
              { date: '2026-01-01', netWorth: 100000 },
              { date: '2026-01-15', netWorth: 125000 },
              { date: '2026-02-01', netWorth: 80000 },
              { date: '2026-02-26', netWorth: 110000 }
            ],
            performance: {
              netPerformance: 10000,
              netPerformancePercentage: 0.1
            }
          }
        }
      ]
    });

    expect(response.answer).toContain('Portfolio evolution: peak net worth 125000 on 2026-01-15.');
    expect(response.answer).toContain(
      'Max drawdown: -36% (from 2026-01-15 to 2026-02-01).'
    );
    expect(response.answer).toContain('Recovery from drawdown low: +37.5%.');
  });

  it('extracts top and bottom holding performers from holdings payload', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'holdings_analysis',
          success: true,
          result: {
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api'],
            data: {
              holdings: {
                AAPL: { symbol: 'AAPL', netPerformancePercent: 1.6952, allocationInPercentage: 0.3 },
                SOLUSD: { symbol: 'SOLUSD', netPerformancePercent: 0.0882, allocationInPercentage: 0.2 },
                BTCUSD: { symbol: 'BTCUSD', netPerformancePercent: 0.0658, allocationInPercentage: 0.15 },
                NVDA: { symbol: 'NVDA', netPerformancePercent: -0.0374, allocationInPercentage: 0.12 },
                AAVEBUSD: { symbol: 'AAVEBUSD', netPerformancePercent: -0.9921, allocationInPercentage: 0.1 },
                USD: { symbol: 'USD', netPerformancePercent: 0, allocationInPercentage: 0.13 }
              }
            }
          }
        }
      ]
    });

    expect(response.answer).toContain(
      'Top performers: AAPL +169.52%, SOLUSD +8.82%, BTCUSD +6.58%.'
    );
    expect(response.answer).toContain(
      'Bottom performers: AAVEBUSD -99.21%, NVDA -3.74%, BTCUSD +6.58%.'
    );
  });

  it('keeps detailed tool failures in Tool errors section without duplicating in Risks/flags', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      toolCalls: [
        {
          toolName: 'analyze_stock_trend',
          success: false,
          result: {
            errorMessage:
              'I could not analyze a holding trend because your portfolio has no holdings yet. Add an asset first, then ask again.',
            reason: 'tool_failure'
          }
        }
      ]
    });

    expect(response.answer).toContain('Tool errors (ground your answer in these');
    expect(response.answer).toContain(
      'analyze_stock_trend: I could not analyze a holding trend because your portfolio has no holdings yet.'
    );
    expect(response.answer).toContain(
      'One or more tool calls failed. See Tool errors for details.'
    );
    expect(response.answer).not.toContain(
      '- I could not analyze a holding trend because your portfolio has no holdings yet. Add an asset first, then ask again.'
    );
  });

  it('answers diversification questions directly and de-duplicates repeated findings across tools', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      userMessage: 'how diverse is my portfolio?',
      toolCalls: [
        {
          toolName: 'holdings_analysis',
          success: true,
          result: {
            allocation: [
              { percentage: 57.55, symbol: 'BTCUSD' },
              { percentage: 19.48, symbol: 'BTC-USD' },
              { percentage: 9.3, symbol: 'TSLA' }
            ],
            performance: {
              netPerformance: 13738.09,
              netPerformancePercentage: 0.0006
            },
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        },
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            allocation: [
              { percentage: 57.55, symbol: 'BTCUSD' },
              { percentage: 19.48, symbol: 'BTC-USD' },
              { percentage: 9.3, symbol: 'TSLA' }
            ],
            performance: {
              netPerformance: 13738.09,
              netPerformancePercentage: 0.0006
            },
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        }
      ]
    });

    expect(response.answer).toContain('Answer: Your portfolio is highly concentrated;');
    expect(response.answer).toContain('Top allocation: BTCUSD 57.55%, BTC-USD 19.48%, TSLA 9.3%.');
    expect(response.answer.match(/Net performance: 13738\.09\./g)?.length).toBe(1);
  });

  it('returns concise no-holdings answer without zero metrics or actionable next steps', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      userMessage: 'how diverse is my portfolio?',
      toolCalls: [
        {
          toolName: 'holdings_analysis',
          success: true,
          result: {
            allocation: [],
            performance: {
              netPerformance: 0,
              netPerformancePercentage: 0
            },
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        }
      ]
    });

    expect(response.answer).toContain(
      'Answer: Your portfolio currently has no holdings, so diversification is not applicable yet.'
    );
    expect(response.answer).toContain('No holdings found in portfolio.');
    expect(response.answer).not.toContain('Net performance: 0');
    expect(response.answer).not.toContain('Risks/flags:');
    expect(response.answer).not.toContain('Actionable next steps:');
  });

  it('answers holdings status and risk questions directly before summary', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      userMessage: 'how are all my holdings doing? any risk ?',
      toolCalls: [
        {
          toolName: 'holdings_analysis',
          success: true,
          result: {
            allocation: [
              { percentage: 57.55, symbol: 'BTCUSD' },
              { percentage: 19.48, symbol: 'BTC-USD' },
              { percentage: 9.3, symbol: 'TSLA' }
            ],
            performance: {
              netPerformance: 13738.09,
              netPerformancePercentage: 0.0006
            },
            data_as_of: '2026-02-26T00:00:00.000Z',
            sources: ['ghostfolio_api']
          }
        }
      ]
    });

    expect(response.answer.startsWith('Answer:')).toBe(true);
    expect(response.answer).toContain('Your holdings are');
    expect(response.answer).toContain('Largest concentration is');
    expect(response.answer).toContain('No critical risks were flagged');
    expect(response.answer).toContain('Key findings:');
  });

  it('does not infer no-holdings from portfolio_analysis-only payload', () => {
    const response = synthesizeToolResults({
      existingFlags: [],
      userMessage: 'how is my portfolio doing?',
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: {
            allocation: [],
            data_as_of: '2026-02-27T00:00:00.000Z',
            performance: {
              currentNetWorth: 351101.8,
              netPerformance: 13521.8,
              netPerformancePercentage: 0.0006
            },
            sources: ['ghostfolio_api'],
            summary: 'Portfolio analysis from Ghostfolio performance data'
          }
        }
      ]
    });

    expect(response.answer).not.toContain('No holdings found in portfolio.');
    expect(response.answer).toContain('Portfolio status: in profit.');
  });
});
