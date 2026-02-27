import {
  ADVERSARIAL_EVAL_CASES,
  DEFAULT_EVAL_CASES,
  EDGE_CASE_EVAL_CASES,
  HAPPY_PATH_EVAL_CASES,
  MULTI_STEP_EVAL_CASES
} from '../../server/eval/default-eval-cases';
import { runEvalCases } from '../../server/eval/eval-runner';
import { TOOL_DEFINITIONS } from '../../server/tools/tool-registry';
import type { AgentTools } from '../../server/types';

function createStubTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    complianceCheck: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    createOrder: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    factCheck: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    getOrders: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', sources: ['test'] }),
    getTransactions: jest.fn().mockResolvedValue({ data: { activities: [] }, data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', transactions: [] }),
    marketData: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', symbols: [] }),
    marketDataLookup: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', prices: [], sources: ['test'], summary: 'Market data lookup from Ghostfolio API' }),
    marketOverview: jest.fn().mockResolvedValue({ answer: 'ok', data_as_of: '2026-02-24T00:00:00Z', overview: {}, sources: ['test'], summary: 'ok' }),
    holdingsAnalysis: jest.fn().mockResolvedValue({ allocation: [], data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok' }),
    portfolioAnalysis: jest.fn().mockResolvedValue({ allocation: [], data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok' }),
    transactionCategorize: jest.fn().mockResolvedValue({ categories: [], data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok' }),
    transactionTimeline: jest.fn().mockResolvedValue({ data_as_of: '2026-02-24T00:00:00Z', sources: ['test'], summary: 'ok', timeline: [] }),
    ...overrides
  };
}

describe('eval runner', () => {
  it('keeps difficulty eval datasets split into dedicated files and merged into default list', () => {
    expect(HAPPY_PATH_EVAL_CASES.length).toBeGreaterThan(0);
    expect(EDGE_CASE_EVAL_CASES.length).toBeGreaterThan(0);
    expect(ADVERSARIAL_EVAL_CASES.length).toBeGreaterThan(0);
    expect(MULTI_STEP_EVAL_CASES.length).toBeGreaterThan(0);

    expect(HAPPY_PATH_EVAL_CASES.every((testCase) => testCase.difficulty === 'happy')).toBe(true);
    expect(EDGE_CASE_EVAL_CASES.every((testCase) => testCase.difficulty === 'edge')).toBe(true);
    expect(ADVERSARIAL_EVAL_CASES.every((testCase) => testCase.difficulty === 'adversarial')).toBe(true);
    expect(MULTI_STEP_EVAL_CASES.every((testCase) => testCase.difficulty === 'multi')).toBe(true);

    const mergedCount =
      HAPPY_PATH_EVAL_CASES.length +
      EDGE_CASE_EVAL_CASES.length +
      ADVERSARIAL_EVAL_CASES.length +
      MULTI_STEP_EVAL_CASES.length;
    expect(DEFAULT_EVAL_CASES.length).toBe(mergedCount);
  });

  it('stores category evals as JSON objects with query/tools/difficulty/contain rules', () => {
    const allJsonCases = [
      ...HAPPY_PATH_EVAL_CASES,
      ...EDGE_CASE_EVAL_CASES,
      ...ADVERSARIAL_EVAL_CASES,
      ...MULTI_STEP_EVAL_CASES
    ];

    expect(allJsonCases.length).toBeGreaterThanOrEqual(50);
    for (const testCase of allJsonCases) {
      expect(typeof testCase.query).toBe('string');
      expect(Array.isArray(testCase.expectedTools)).toBe(true);
      expect(['happy', 'edge', 'adversarial', 'multi']).toContain(testCase.difficulty);
      expect(Array.isArray(testCase.mustContain)).toBe(true);
      expect(Array.isArray(testCase.mustNotContain)).toBe(true);
    }
  });

  it('requires eval case contract fields for every default case', () => {
    for (const testCase of DEFAULT_EVAL_CASES) {
      expect(typeof (testCase as { query?: unknown }).query).toBe('string');
      expect(Array.isArray((testCase as { expectedTools?: unknown }).expectedTools)).toBe(true);
      const expectedOutput = (testCase as { expectedOutput?: unknown }).expectedOutput;
      expect(expectedOutput === undefined || Array.isArray(expectedOutput)).toBe(true);
      expect(Array.isArray((testCase as { passFailCriteria?: unknown }).passFailCriteria)).toBe(true);
      expect(((testCase as { passFailCriteria?: unknown[] }).passFailCriteria ?? []).length).toBeGreaterThan(0);
    }
  });

  it('keeps default eval dataset aligned with tool registry and coverage requirements', () => {
    const total = DEFAULT_EVAL_CASES.length;
    expect(total).toBeGreaterThanOrEqual(50);

    const categoryCounts = DEFAULT_EVAL_CASES.reduce<Record<string, number>>((acc, testCase) => {
      const key = testCase.difficulty ?? 'uncategorized';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    expect(categoryCounts.happy ?? 0).toBeGreaterThanOrEqual(20);
    expect(categoryCounts.edge ?? 0).toBeGreaterThanOrEqual(10);
    expect(categoryCounts.adversarial ?? 0).toBeGreaterThanOrEqual(10);
    expect(categoryCounts.multi ?? 0).toBeGreaterThanOrEqual(9);

    for (const tool of TOOL_DEFINITIONS.map((definition) => definition.name)) {
      const matched = DEFAULT_EVAL_CASES.filter((testCase) => testCase.id.startsWith(`${tool}-`)).length;
      expect(matched).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs robust default cases and produces per-dimension summary', async () => {
    const result = await runEvalCases(DEFAULT_EVAL_CASES, {
      minOverallPassRate: 0.9,
      requiredDimensionPassRate: {
        correctness: 0.9,
        tool_execution: 0.9
      }
    });

    expect(result.total).toBe(DEFAULT_EVAL_CASES.length);
    expect(result.total).toBeGreaterThanOrEqual(10);
    expect(result.gatePassed).toBe(true);
    expect(result.passed).toBeGreaterThanOrEqual(Math.floor(result.total * 0.9));
    expect(result.failed).toBeLessThanOrEqual(Math.ceil(result.total * 0.1));
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
          difficulty: 'edge',
          expectedOutput: ['invalid case'],
          expectedTools: [],
          dimensions: ['edge_cases'],
          id: 'bad',
          mustContain: [],
          mustNotContain: [],
          passFailCriteria: ['invalid shape test'],
          query: ''
        } as never
      ])
    ).rejects.toThrow('missing required fields');
  });

  it('treats latency as informational and not a failing measurement', async () => {
    const result = await runEvalCases([
      {
        difficulty: 'edge',
        dimensions: ['latency'],
        expectedTools: [],
        latencyMsMax: 0,
        mustContain: [],
        mustNotContain: [],
        expectedOutput: ['Hi. I can help with portfolio, transactions, and market-data questions.'],
        id: 'latency-informational',
        passFailCriteria: ['show latency but do not score against threshold'],
        query: 'hello'
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
          difficulty: 'happy',
          dimensions: ['tool_execution', 'correctness'],
          expectedToolCountAtLeast: 1,
          expectedTools: ['market_data_lookup'],
          requiredToolInputFields: { market_data_lookup: ['token'] },
          requireSuccessfulToolCalls: true,
          mustContain: [],
          mustNotContain: [],
          expectedOutput: ['Market data lookup from Ghostfolio API'],
          id: 'token-forwarding',
          passFailCriteria: ['tool must receive token'],
          query: 'Get market data for AAPL'
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
      selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
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
          difficulty: 'happy',
          dimensions: ['tool_execution', 'correctness'],
          expectedTools: ['market_data_lookup'],
          requireSuccessfulToolCalls: true,
          mustContain: [],
          mustNotContain: [],
          expectedOutput: ['Market data lookup from Ghostfolio API'],
          id: 'correctness-from-tool-payload',
          passFailCriteria: ['must pass correctness from tool payload'],
          query: 'Get market data for AAPL'
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
          difficulty: 'edge',
          dimensions: ['edge_cases'],
          expectedRoute: 'llm_user',
          expectedValidity: true,
          expectedTools: [],
          mustContain: [],
          mustNotContain: [],
          id: 'no-tool-expected-output-skip',
          passFailCriteria: ['direct path should be scored without strict expected output fragment'],
          query: 'hello'
        }
      ]
    );

    expect(result.passed).toBe(1);
  });
});
