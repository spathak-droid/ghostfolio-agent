import { DEFAULT_EVAL_CASES } from '../../server/eval/default-eval-cases';
import { runEvalCases } from '../../server/eval/eval-runner';
import type { AgentTools } from '../../server/types';

function createStubTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    createOrder: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    getTransactions: jest.fn().mockResolvedValue({ data: { activities: [] }, data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', transactions: [] }),
    marketData: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', symbols: [] }),
    marketDataLookup: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', prices: [], sources: ['test'], summary: 'Market data lookup from Ghostfolio API' }),
    marketOverview: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', overview: {}, sources: ['test'], summary: 'ok' }),
    portfolioAnalysis: jest.fn().mockResolvedValue({ allocation: [], data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok' }),
    transactionCategorize: jest.fn().mockResolvedValue({ categories: [], data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok' }),
    transactionTimeline: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', timeline: [] }),
    updateOrder: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    ...overrides
  };
}

describe('eval runner', () => {
  it('requires eval case contract fields for every default case', () => {
    for (const testCase of DEFAULT_EVAL_CASES) {
      expect(typeof (testCase as { inputQuery?: unknown }).inputQuery).toBe('string');
      expect(Array.isArray((testCase as { expectedToolCalls?: unknown }).expectedToolCalls)).toBe(true);
      expect(Array.isArray((testCase as { expectedOutput?: unknown }).expectedOutput)).toBe(true);
      expect(Array.isArray((testCase as { passFailCriteria?: unknown }).passFailCriteria)).toBe(true);
      expect(((testCase as { passFailCriteria?: unknown[] }).passFailCriteria ?? []).length).toBeGreaterThan(0);
    }
  });

  it('runs robust default cases and produces per-dimension summary', async () => {
    const result = await runEvalCases(DEFAULT_EVAL_CASES, {
      minOverallPassRate: 0.9,
      requiredDimensionPassRate: {
        correctness: 0.9,
        tool_execution: 0.9,
        tool_selection: 0.8
      }
    });

    expect(result.total).toBeGreaterThanOrEqual(10);
    expect(result.passed).toBe(result.total);
    expect(result.failed).toBe(0);
    expect(result.gatePassed).toBe(true);
    expect(result.perDimension.tool_execution.passRate).toBeGreaterThanOrEqual(0.9);
    expect(result.perDimension.correctness.passRate).toBeGreaterThanOrEqual(0.9);
  });

  it('fails gate when threshold is too strict', async () => {
    const result = await runEvalCases(DEFAULT_EVAL_CASES, {
      minOverallPassRate: 1.1
    });

    expect(result.gatePassed).toBe(false);
  });

  it('rejects malformed eval cases missing mandatory contract fields', async () => {
    await expect(
      runEvalCases([
        {
          dimensions: ['edge_cases'],
          expectation: {},
          id: 'bad'
        } as never
      ])
    ).rejects.toThrow('missing required fields');
  });

  it('treats latency as informational and not a failing measurement', async () => {
    const result = await runEvalCases([
      {
        dimensions: ['latency'],
        expectation: {
          latencyMsMax: 0
        },
        expectedOutput: ['Hi. I can help with portfolio, transactions, and market-data questions.'],
        expectedToolCalls: [],
        id: 'latency-informational',
        inputQuery: 'hello',
        passFailCriteria: ['show latency but do not score against threshold']
      }
    ]);

    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.perDimension.latency.passRate).toBe(1);
  });

  it('forwards requestToken into tool inputs when using custom tool set', async () => {
    const marketDataLookup = jest.fn().mockResolvedValue({
      data_as_of: '2026-02-24T00:00:00Z',
      prices: [],
      sources: ['test'],
      summary: 'Market data lookup from Ghostfolio API'
    });
    const tools = createStubTools({ marketDataLookup });

    const result = await runEvalCases(
      [
        {
          dimensions: ['tool_execution', 'correctness'],
          expectation: {
            expectedToolCountAtLeast: 1,
            expectedTools: ['market_data_lookup'],
            requiredToolInputFields: { market_data_lookup: ['token'] },
            requireSuccessfulToolCalls: true
          },
          expectedOutput: ['Market data lookup from Ghostfolio API'],
          expectedToolCalls: ['market_data_lookup'],
          id: 'token-forwarding',
          inputQuery: 'Get market data for AAPL',
          passFailCriteria: ['tool must receive token']
        }
      ],
      {
        requestToken: 'token-abc-123',
        tools
      }
    );

    const callArg = (marketDataLookup.mock.calls[0]?.[1] ?? marketDataLookup.mock.calls[0]?.[0]) as {
      token?: string;
    };

    expect(callArg.token).toBe('token-abc-123');
    expect(result.passed).toBe(1);
  });

  it('uses tool payload text for correctness checks when answer wording differs', async () => {
    const llm = {
      answerFinanceQuestion: jest.fn().mockResolvedValue('free-form response'),
      reasonAboutQuery: jest.fn().mockResolvedValue({
        intent: 'finance',
        mode: 'tool_call',
        tool: 'market_data_lookup'
      }),
      selectTool: jest.fn().mockResolvedValue({ tool: 'none' }),
      synthesizeFromToolResults: jest.fn().mockResolvedValue('paraphrased output')
    };
    const tools = createStubTools({
      marketDataLookup: jest.fn().mockResolvedValue({
        data_as_of: '2026-02-24T00:00:00Z',
        prices: [],
        sources: ['test'],
        summary: 'Market data lookup from Ghostfolio API'
      })
    });

    const result = await runEvalCases(
      [
        {
          dimensions: ['tool_execution', 'correctness'],
          expectation: {
            expectedTools: ['market_data_lookup'],
            requireSuccessfulToolCalls: true
          },
          expectedOutput: ['Market data lookup from Ghostfolio API'],
          expectedToolCalls: ['market_data_lookup'],
          id: 'correctness-from-tool-payload',
          inputQuery: 'Get market data for AAPL',
          passFailCriteria: ['must pass correctness from tool payload']
        }
      ],
      { llm: llm as never, tools }
    );

    expect(result.passed).toBe(1);
  });

  it('does not enforce expectedOutput text for direct no-tool cases', async () => {
    const result = await runEvalCases(
      [
        {
          dimensions: ['edge_cases'],
          expectation: {
            expectedRoute: 'llm_user',
            expectedValidity: true
          },
          expectedOutput: ['this text should not be required for no-tool path'],
          expectedToolCalls: [],
          id: 'no-tool-expected-output-skip',
          inputQuery: 'hello',
          passFailCriteria: ['direct path should be scored without strict expected output fragment']
        }
      ]
    );

    expect(result.passed).toBe(1);
  });
});
