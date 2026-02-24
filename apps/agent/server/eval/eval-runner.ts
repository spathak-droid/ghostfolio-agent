import { createAgent } from '../agent';
import { SELECTABLE_TOOL_NAMES } from '../tools/tool-registry';

export interface EvalCase {
  input: string;
  expectedTool?: (typeof SELECTABLE_TOOL_NAMES)[number];
  expectedContains?: string;
  expectedFlag?: string;
}

export interface EvalSummary {
  failed: number;
  passed: number;
  results: { index: number; passed: boolean; reason?: string }[];
  total: number;
}

export async function runEvalCases(cases: EvalCase[]): Promise<EvalSummary> {
  const agent = createAgent({
    tools: {
      getTransactions: async () => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api'],
          summary: 'Fetched 0 transactions from Ghostfolio',
          transactions: []
        };
      },
      marketData: async () => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api'],
          summary: 'Market data (current price and optional 1-month change)',
          symbols: []
        };
      },
      marketDataLookup: async () => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api'],
          summary: 'Market data lookup from Ghostfolio API'
        };
      },
      portfolioAnalysis: async () => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api'],
          summary: 'Portfolio analysis from Ghostfolio data'
        };
      },
      transactionCategorize: async ({ message }) => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          input: message,
          sources: ['agent_internal'],
          summary: 'Transaction categorization completed'
        };
      },
      transactionTimeline: async () => {
        return {
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['agent_internal'],
          summary: 'Found 0 matching transactions',
          timeline: []
        };
      },
      createOrder: async () => {
        return {
          success: true,
          needsClarification: true,
          answer: 'How many shares do you want to buy?',
          summary: 'Quantity required',
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api']
        };
      },
      updateOrder: async () => {
        return {
          success: true,
          needsClarification: true,
          answer: 'Please provide the order/activity id to update.',
          summary: 'Order id required',
          data_as_of: '2026-02-24T00:00:00Z',
          sources: ['ghostfolio_api']
        };
      }
    }
  });

  const results: EvalSummary['results'] = [];

  for (const [index, testCase] of cases.entries()) {
    const response = await agent.chat({
      conversationId: `eval-${index}`,
      message: testCase.input,
      token: undefined
    });

    const usedTool = response.toolCalls[0]?.toolName;

    if (testCase.expectedTool && usedTool !== testCase.expectedTool) {
      results.push({
        index,
        passed: false,
        reason: `expected tool ${testCase.expectedTool} but got ${usedTool ?? 'none'}`
      });
      continue;
    }

    if (
      testCase.expectedContains &&
      !response.answer.toLowerCase().includes(testCase.expectedContains.toLowerCase())
    ) {
      results.push({
        index,
        passed: false,
        reason: `answer missing expected fragment: ${testCase.expectedContains}`
      });
      continue;
    }

    if (
      testCase.expectedFlag &&
      !response.verification.flags?.includes(testCase.expectedFlag)
    ) {
      results.push({
        index,
        passed: false,
        reason: `missing expected verification flag: ${testCase.expectedFlag}`
      });
      continue;
    }

    results.push({ index, passed: true });
  }

  const passed = results.filter(({ passed: resultPassed }) => resultPassed).length;

  return {
    failed: results.length - passed,
    passed,
    results,
    total: results.length
  };
}
